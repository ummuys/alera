function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function hexToRgba(hex) {
  const normalized = String(hex || '#000000').replace('#', '').trim();

  if (normalized.length === 3) {
    return [
      parseInt(normalized[0] + normalized[0], 16),
      parseInt(normalized[1] + normalized[1], 16),
      parseInt(normalized[2] + normalized[2], 16),
      255,
    ];
  }

  if (normalized.length >= 6) {
    return [
      parseInt(normalized.slice(0, 2), 16),
      parseInt(normalized.slice(2, 4), 16),
      parseInt(normalized.slice(4, 6), 16),
      255,
    ];
  }

  return [0, 0, 0, 255];
}

export function rgbToHex(r, g, b) {
  const toHex = (value) => clamp(Math.round(value), 0, 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function getColorAt(data, width, x, y) {
  const index = (y * width + x) * 4;
  return [data[index], data[index + 1], data[index + 2], data[index + 3]];
}

function setColorAt(data, width, x, y, color) {
  const index = (y * width + x) * 4;
  data[index] = color[0];
  data[index + 1] = color[1];
  data[index + 2] = color[2];
  data[index + 3] = color[3];
}

function isWithinTolerance(color, target, tolerance) {
  return Math.abs(color[0] - target[0]) <= tolerance
    && Math.abs(color[1] - target[1]) <= tolerance
    && Math.abs(color[2] - target[2]) <= tolerance
    && Math.abs(color[3] - target[3]) <= tolerance;
}

export function floodFillCanvas(canvas, ctx, point, fillColor, options = {}) {
  const width = canvas.width;
  const height = canvas.height;
  const maxSegments = options.maxSegments || 2500;
  const tolerance = options.tolerance ?? 10;

  if (!width || !height) {
    return { segments: [], color: fillColor };
  }

  const startX = clamp(Math.floor(point.x * width), 0, width - 1);
  const startY = clamp(Math.floor(point.y * height), 0, height - 1);

  const imageData = ctx.getImageData(0, 0, width, height);
  const { data } = imageData;
  const target = getColorAt(data, width, startX, startY);
  const fill = hexToRgba(fillColor);

  if (isWithinTolerance(target, fill, tolerance)) {
    return { segments: [], color: fillColor };
  }

  const visited = new Uint8Array(width * height);
  const stack = [[startX, startY]];
  const runs = [];

  while (stack.length && runs.length < maxSegments) {
    const [seedX, seedY] = stack.pop();
    let left = seedX;
    let right = seedX;

    while (left >= 0) {
      const idx = seedY * width + left;
      if (visited[idx] || !isWithinTolerance(getColorAt(data, width, left, seedY), target, tolerance)) {
        break;
      }
      left -= 1;
    }
    left += 1;

    while (right < width) {
      const idx = seedY * width + right;
      if (visited[idx] || !isWithinTolerance(getColorAt(data, width, right, seedY), target, tolerance)) {
        break;
      }
      right += 1;
    }
    right -= 1;

    if (right < left) {
      continue;
    }

    for (let x = left; x <= right; x += 1) {
      const idx = seedY * width + x;
      visited[idx] = 1;
      setColorAt(data, width, x, seedY, fill);
    }

    runs.push({ y: seedY, x0: left, x1: right });

    const scanNeighbor = (neighborY) => {
      if (neighborY < 0 || neighborY >= height) {
        return;
      }

      let inSpan = false;

      for (let x = left; x <= right; x += 1) {
        const idx = neighborY * width + x;
        const matches = !visited[idx]
          && isWithinTolerance(getColorAt(data, width, x, neighborY), target, tolerance);

        if (matches && !inSpan) {
          stack.push([x, neighborY]);
          inSpan = true;
        } else if (!matches) {
          inSpan = false;
        }
      }
    };

    scanNeighbor(seedY - 1);
    scanNeighbor(seedY + 1);
  }

  ctx.putImageData(imageData, 0, 0);

  const segments = runs.map((run) => ({
    x0: run.x0 / width,
    y0: (run.y + 0.5) / height,
    x1: (run.x1 + 1) / width,
    y1: (run.y + 0.5) / height,
    color: fillColor,
    size: 1,
    tool: 'pen',
  }));

  return { segments, color: fillColor };
}
