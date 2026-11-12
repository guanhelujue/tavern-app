/// <reference types="node" />

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const settingsSource = readFileSync(
  fileURLToPath(new URL('../../app/explore.tsx', import.meta.url)),
  'utf8',
);

describe('system settings UI contract', () => {
  it('does not expose the global worldbook from system settings', () => {
    expect(settingsSource).not.toContain('label="世界书"');
    expect(settingsSource).not.toContain("router.push('/worldbook'");
  });

  it('keeps connection, image, export, and mobile settings entries organized', () => {
    for (const title of ['外观', '模型连接', '图像引擎', '导出与高级']) {
      expect(settingsSource).toContain(`title="${title}"`);
    }

    expect(settingsSource).toContain("['数据与参数'");
    expect(settingsSource).toContain("['应用'");
    expect(settingsSource).toContain("'导出设置'");
    expect(settingsSource).toContain("'高级参数'");
    expect(settingsSource).not.toContain('summarizeAllProjectsUsage');
  });

  it('does not duplicate model assignment controls inside provider connections', () => {
    expect(settingsSource).toContain('这里维护连接与模型清单；获取模型后，在正文、灵感等功能页面分别选择。');
    expect(settingsSource).not.toContain('title="选择默认模型"');
    expect(settingsSource).not.toContain('设为默认');
  });

  it('keeps sensitive and technical details inside their relevant sections', () => {
    const connectionStart = settingsSource.indexOf('title="模型连接"');
    const imageStart = settingsSource.indexOf('title="图像引擎"');
    const exportStart = settingsSource.indexOf('title="导出与高级"');

    expect(connectionStart).toBeGreaterThan(-1);
    expect(settingsSource.indexOf('{providerSecretsWarning ?', connectionStart)).toBeGreaterThan(connectionStart);
    expect(settingsSource.indexOf('{providerSecretsWarning ?', connectionStart)).toBeLessThan(imageStart);
    expect(settingsSource).not.toContain('title="高级图像连接设置"');
    expect(settingsSource).not.toContain('套用本地 ComfyUI');
    const imageSection = settingsSource.slice(imageStart, exportStart);
    expect(imageSection).toContain('label="图像 API Key"');
    expect(imageSection).toContain('label="图像模型 ID"');
    expect(imageSection).toContain('label="图像接口格式"');
  });
});
