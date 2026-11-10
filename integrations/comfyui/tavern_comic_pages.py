"""Local ComfyUI nodes for Tavern comic page composition and reference fitting."""

import json
import os
import torch
from PIL import Image, ImageDraw, ImageFont, ImageOps


_MIN_SIZE = 512
_MAX_SIZE = 4096
_MAX_PIXELS = 16 * 1024 * 1024
_WARM_WHITE = (248, 246, 240)
_BORDER = (63, 59, 52)


def _validate_canvas(width, height):
    width = int(width)
    height = int(height)
    if not (_MIN_SIZE <= width <= _MAX_SIZE and _MIN_SIZE <= height <= _MAX_SIZE):
        raise ValueError(f"canvas must be between {_MIN_SIZE} and {_MAX_SIZE} pixels per side")
    if width * height > _MAX_PIXELS:
        raise ValueError("canvas exceeds 16 megapixels")
    return width, height


def _font_path():
    candidates = [
        r"C:\Windows\Fonts\msyh.ttc",
        r"C:\Windows\Fonts\msyhbd.ttc",
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/opentype/noto/NotoSansCJKsc-Regular.otf",
        "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
    ]
    for candidate in candidates:
        if os.path.exists(candidate):
            return candidate
    raise RuntimeError("Chinese font not found; install Microsoft YaHei or Noto Sans CJK")


def _load_font(size):
    return ImageFont.truetype(_font_path(), size=size)


def _to_pil(image):
    if not isinstance(image, torch.Tensor):
        raise TypeError("image input must be a torch.Tensor")
    if image.ndim == 3:
        image = image.unsqueeze(0)
    if image.ndim != 4 or image.shape[0] != 1 or image.shape[-1] not in (3, 4):
        raise ValueError("image input must have batch 1 and shape [1,H,W,3/4]")
    image = image.detach().to(device="cpu", dtype=torch.float32).clamp(0, 1)[0]
    channels = image[..., :3]
    array = (channels.mul(255).round().to(torch.uint8).numpy())
    return Image.fromarray(array, mode="RGB")


def _to_tensor(image):
    raw = torch.frombuffer(bytearray(image.tobytes()), dtype=torch.uint8)
    array = raw.reshape(image.height, image.width, 3).to(dtype=torch.float32) / 255.0
    return array.unsqueeze(0).contiguous()


def _contain(image, width, height, color=_WARM_WHITE):
    return ImageOps.pad(image, (width, height), method=Image.Resampling.LANCZOS, color=color, centering=(0.5, 0.5))


def _wrap_text(text, font, max_width):
    text = str(text or "")
    lines = []
    for paragraph in text.splitlines() or [""]:
        current = ""
        for char in paragraph:
            candidate = current + char
            if font.getlength(candidate) <= max_width or not current:
                current = candidate
            else:
                lines.append(current)
                current = char
        lines.append(current)
    return lines


def _fit_text(draw, text, max_width, max_height, preferred=44, minimum=26):
    for size in range(preferred, minimum - 1, -1):
        font = _load_font(size)
        lines = _wrap_text(text, font, max_width)
        line_height = max(font.getbbox("国g")[3], size) + 6
        if len(lines) * line_height <= max_height:
            return font, lines, line_height
    raise ValueError("caption or dialogue text does not fit in captionHeight")


def _validate_layout(layout, width, height):
    if not isinstance(layout, dict) or not isinstance(layout.get("panels"), list):
        raise ValueError("layout_json must contain a panels array")
    panels = layout["panels"]
    if not 1 <= len(panels) <= 4:
        raise ValueError("layout must contain between 1 and 4 panels")
    boxes = []
    for index, panel in enumerate(panels, 1):
        try:
            x, y = int(panel["x"]), int(panel["y"])
            panel_width, panel_height = int(panel["width"]), int(panel["height"])
            caption_height = int(panel.get("captionHeight", 0))
        except (KeyError, TypeError, ValueError) as exc:
            raise ValueError(f"panel {index} has invalid geometry") from exc
        if x < 0 or y < 90 or panel_width <= 0 or panel_height <= 0 or caption_height < 40:
            raise ValueError(f"panel {index} geometry is invalid or overlaps title area")
        if x + panel_width > width or y + panel_height > height:
            raise ValueError(f"panel {index} is outside canvas bounds")
        image_height = panel_height - caption_height
        if image_height < 32:
            raise ValueError(f"panel {index} leaves no usable image area")
        for other in boxes:
            if x < other[0] + other[2] and other[0] < x + panel_width and y < other[1] + other[3] and other[1] < y + panel_height:
                raise ValueError(f"panel {index} overlaps another panel")
        boxes.append((x, y, panel_width, panel_height))
    return panels


class TavernFitReference:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"image": ("IMAGE",), "width": ("INT", {"default": 768, "min": _MIN_SIZE, "max": _MAX_SIZE}), "height": ("INT", {"default": 1024, "min": _MIN_SIZE, "max": _MAX_SIZE})}}

    RETURN_TYPES = ("IMAGE",)
    FUNCTION = "fit"
    CATEGORY = "Tavern/Comic"

    def fit(self, image, width, height):
        width, height = _validate_canvas(width, height)
        return (_to_tensor(_contain(_to_pil(image), width, height)),)


class TavernComicPage:
    @classmethod
    def INPUT_TYPES(cls):
        optional = {f"image_{index}": ("IMAGE",) for index in range(1, 5)}
        return {"required": {"width": ("INT", {"default": 1536, "min": _MIN_SIZE, "max": _MAX_SIZE}), "height": ("INT", {"default": 2304, "min": _MIN_SIZE, "max": _MAX_SIZE}), "title": ("STRING", {"default": "", "multiline": False}), "layout_json": ("STRING", {"default": '{"panels": []}', "multiline": True})}, "optional": optional}

    RETURN_TYPES = ("IMAGE",)
    FUNCTION = "compose"
    CATEGORY = "Tavern/Comic"

    def compose(self, width, height, title, layout_json, **images):
        width, height = _validate_canvas(width, height)
        try:
            layout = json.loads(layout_json)
        except (TypeError, json.JSONDecodeError) as exc:
            raise ValueError("layout_json must be valid JSON") from exc
        panels = _validate_layout(layout, width, height)
        sources = [images.get(f"image_{index}") for index in range(1, len(panels) + 1)]
        if any(source is None for source in sources):
            raise ValueError("each panel requires a connected image input")

        canvas = Image.new("RGB", (width, height), _WARM_WHITE)
        draw = ImageDraw.Draw(canvas)
        title_font, title_lines, title_line_height = _fit_text(draw, title, width - 96, 76, preferred=48, minimum=26)
        if title:
            for line_index, line in enumerate(title_lines):
                draw.text((48, 24 + line_index * title_line_height), line, fill=(35, 33, 30), font=title_font)

        for index, (panel, source) in enumerate(zip(panels, sources), 1):
            x, y = int(panel["x"]), int(panel["y"])
            panel_width, panel_height = int(panel["width"]), int(panel["height"])
            caption_height = int(panel.get("captionHeight", 0))
            image_height = panel_height - caption_height
            fitted = _contain(_to_pil(source), panel_width - 8, image_height - 8, color=(238, 236, 230))
            canvas.paste(fitted, (x + 4, y + 4))
            draw.rectangle((x, y, x + panel_width - 1, y + panel_height - 1), outline=_BORDER, width=3)

            dialogue = []
            for item in panel.get("dialogue", []) or []:
                if not isinstance(item, dict) or not item.get("text"):
                    continue
                speaker = str(item.get("speaker", "")).strip()
                dialogue.append(f"{speaker}: {item['text']}" if speaker else str(item["text"]))
            text = "\n".join([str(panel.get("caption", ""))] + dialogue).strip()
            if text:
                text_x, text_y = x + 14, y + image_height + 12
                text_width = panel_width - 28
                text_height = caption_height - 20
                font, lines, line_height = _fit_text(draw, text, text_width, text_height)
                for line_index, line in enumerate(lines):
                    draw.text((text_x, text_y + line_index * line_height), line, fill=(35, 33, 30), font=font)
        return (_to_tensor(canvas),)


NODE_CLASS_MAPPINGS = {"TavernFitReference": TavernFitReference, "TavernComicPage": TavernComicPage}
NODE_DISPLAY_NAME_MAPPINGS = {"TavernFitReference": "Tavern Fit Reference", "TavernComicPage": "Tavern Comic Page"}
