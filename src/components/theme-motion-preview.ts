type Listener = (revision: number) => void;

const listeners = new Set<Listener>();
let revision = 0;

export function requestThemeMotionPreview() {
  revision += 1;
  listeners.forEach((listener) => listener(revision));
}

export function subscribeThemeMotionPreview(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
