// ============================================
// VERSION PRESETS - Add after existing constants
// ============================================

const VERSION_PRESETS = {
  version1: {
    name: "Original Enhanced",
    speed: 1.0,
    saturation: 1.1,
    brightness: 0.02,
    contrast: 1.05,
    audioPitch: 0,
    cropPercent: 0,
    description: "Slightly enhanced colors and contrast"
  },
  version2: {
    name: "Warm & Slower",
    speed: 0.85,
    saturation: 1.25,
    brightness: 0.05,
    contrast: 1.1,
    audioPitch: -2,
    cropPercent: 3,
    colorTemp: "warm",
    description: "Warmer tones, 15% slower, zoomed in"
  },
  version3: {
    name: "Cool & Crisp",
    speed: 1.15,
    saturation: 0.9,
    brightness: -0.03,
    contrast: 1.15,
    audioPitch: 2,
    cropPercent: 5,
    colorTemp: "cool",
    sharpen: 1.2,
    description: "Cooler tones, 15% faster, sharpened"
  },
  version4: {
    name: "Vibrant Motion",
    speed: 0.9,
    saturation: 1.4,
    brightness: 0.08,
    contrast: 1.2,
    audioPitch: -1,
    cropPercent: 7,
    vignette: true,
    description: "High saturation, 10% slower, vignette effect"
  },
  version5: {
    name: "Subtle Shift",
    speed: 1.05,
    saturation: 1.05,
    brightness: 0.01,
    contrast: 1.08,
    audioPitch: 1,
    cropPercent: 2,
    gaussianBlur: 0.3,
    description: "Minimal changes, slight repositioning"
  }
};
