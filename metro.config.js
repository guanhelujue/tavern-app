const { getDefaultConfig } = require('expo/metro-config');
const { createLocalComfyLauncher } = require('./scripts/comfyui-launcher.cjs');

const config = getDefaultConfig(__dirname);
const launcher = createLocalComfyLauncher();
const previousEnhancer = config.server?.enhanceMiddleware;

config.server = {
  ...config.server,
  enhanceMiddleware: (middleware, server) => {
    const nextMiddleware = previousEnhancer ? previousEnhancer(middleware, server) : middleware;
    return (req, res, next) => launcher.handle(req, res, () => nextMiddleware(req, res, next));
  },
};

module.exports = config;
