# Showcase Library Draft

## Goals
- Standalone open-source package that renders screenshot carousels to GIF or MP4.
- Single config format: YAML (JSON is accepted because YAML is a superset).
- Themeable typography, colors, spacing, and layout with per-slide overrides.
- CLI-first and importable as a Python library.

## Config Schema Draft (YAML)
Top-level keys are stable; nested keys are optional unless noted.

- version: int, required
- assets_dir: path, optional
- output: object, required
  - path: path, required
  - format: gif|mp4, required
  - fps: int, optional
  - loop: int, optional
  - optimize: bool, optional
  - mp4: object, optional
    - codec: str, optional
    - pixel_format: str, optional
    - crf: int, optional
    - preset: str, optional
- layout: object, optional
  - width: int, optional
  - caption_height: int, optional
  - padding_x: int, optional
  - title_line_spacing: int, optional
  - subtitle_line_spacing: int, optional
  - subtitle_gap: int, optional
  - align: left|center|right, optional
- theme: object, optional
  - colors: object, optional
    - canvas: str, optional
    - caption: str, optional
    - title: str, optional
    - subtitle: str, optional
  - fonts: object, optional
    - title: object, optional
      - size: int, optional
      - color: str, optional
      - files: list[str], optional
    - subtitle: object, optional
      - size: int, optional
      - color: str, optional
      - files: list[str], optional
- image: object, optional
  - fit: contain|cover, optional
  - position: center|top|bottom|left|right, optional
  - background: str, optional
  - radius: int, optional
  - shadow: object, optional
    - color: str, optional
    - offset_x: int, optional
    - offset_y: int, optional
    - blur: int, optional
- timing: object, optional
  - slide_duration_ms: int, optional
- transitions: object, optional
  - type: none|crossfade, optional
  - duration_ms: int, optional
  - steps: int, optional
- slides: list, required
  - image: str, required
  - title: str, optional
  - subtitle: str, optional
  - duration_ms: int, optional
  - overrides: object, optional
    - layout: object, optional
    - theme: object, optional
    - image: object, optional
    - timing: object, optional
    - transitions: object, optional

### Minimal Example
```yaml
version: 1
assets_dir: assets
output:
  path: out/showcase.gif
  format: gif
layout:
  width: 1200
  caption_height: 220
theme:
  colors:
    canvas: "#F5F6FA"
    caption: "#F5F6FA"
    title: "#1E2330"
    subtitle: "#5E6572"
  fonts:
    title:
      size: 40
    subtitle:
      size: 24
timing:
  slide_duration_ms: 1400
transitions:
  type: crossfade
  duration_ms: 250
  steps: 2
slides:
  - image: screen-1.png
    title: Title one
    subtitle: Subtitle one
```

### Full Example With Overrides
```yaml
version: 1
assets_dir: assets
output:
  path: out/showcase.mp4
  format: mp4
  fps: 30
  mp4:
    codec: libx264
    pixel_format: yuv420p
    crf: 18
    preset: medium
layout:
  width: 1200
  caption_height: 230
  padding_x: 80
  title_line_spacing: 6
  subtitle_line_spacing: 4
  subtitle_gap: 12
  align: center
theme:
  colors:
    canvas: "#F5F6FA"
    caption: "#F5F6FA"
    title: "#1E2330"
    subtitle: "#5E6572"
  fonts:
    title:
      size: 40
      color: "#1E2330"
      files:
        - fonts/Inter-Bold.ttf
    subtitle:
      size: 24
      color: "#5E6572"
      files:
        - fonts/Inter-Regular.ttf
image:
  fit: contain
  position: center
  background: "#F5F6FA"
  radius: 12
  shadow:
    color: "#000000"
    offset_x: 0
    offset_y: 10
    blur: 24
timing:
  slide_duration_ms: 1750
transitions:
  type: crossfade
  duration_ms: 250
  steps: 2
slides:
  - image: screen-1.png
    title: One
    subtitle: First slide
  - image: screen-2.png
    title: Two
    subtitle: Override caption background
    overrides:
      theme:
        colors:
          caption: "#FFFFFF"
      layout:
        caption_height: 260
```

## Package Layout Draft
```
showcase/
  pyproject.toml
  README.md
  LICENSE
  showcase/
    __init__.py
    cli.py
    config.py
    model.py
    renderer.py
    text.py
    layout.py
    assets.py
    exporters/
      __init__.py
      gif.py
      mp4.py
  examples/
    minimal.yml
    themed.yml
    assets/
  tests/
    fixtures/
    test_smoke.py
```

## Dependency Notes
- Core: Pillow, PyYAML, pydantic.
- MP4: optional dependency on imageio or ffmpeg-python with ffmpeg installed.
- CLI entry point: showcase (python -m showcase).
