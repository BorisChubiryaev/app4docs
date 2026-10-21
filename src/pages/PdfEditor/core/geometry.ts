// Координаты «как на экране» для страницы с любым поворотом.
//
// Всё, что PDF Studio рисует на странице, задаётся в системе отображаемой
// страницы: X вправо, Y вверх, начало — левый нижний угол того, что видит
// пользователь. Матрица `m` переводит её в собственные координаты страницы
// с учётом /Rotate и CropBox, поэтому подписи, номера и водяной знак стоят
// ровно и на своих местах на повёрнутых страницах.
import {
  concatTransformationMatrix,
  popGraphicsState,
  pushGraphicsState,
  type PDFPage,
} from "pdf-lib";

export type Mat = [number, number, number, number, number, number];

export type Frame = { W: number; H: number; m: Mat };

export const normRot = (r: number) => ((Math.round(r / 90) * 90) % 360 + 360) % 360;

/** Система отображаемой страницы при повороте `rot` (по часовой). */
export function displayFrame(page: PDFPage, rot: number): Frame {
  const box = page.getCropBox();
  const w = box.width;
  const h = box.height;
  const R = normRot(rot);
  // x = aX + cY + e, y = bX + dY + f
  const t: Record<number, Mat> = {
    0: [1, 0, 0, 1, 0, 0],
    90: [0, 1, -1, 0, w, 0],
    180: [-1, 0, 0, -1, w, h],
    270: [0, -1, 1, 0, 0, h],
  };
  const m = [...t[R]] as Mat;
  m[4] += box.x;
  m[5] += box.y;
  return { W: R % 180 ? h : w, H: R % 180 ? w : h, m };
}

/** Произведение: сначала `b`, затем `a` (как в PDF: cm a, затем cm b). */
export function mul(a: Mat, b: Mat): Mat {
  return [
    b[0] * a[0] + b[1] * a[2],
    b[0] * a[1] + b[1] * a[3],
    b[2] * a[0] + b[3] * a[2],
    b[2] * a[1] + b[3] * a[3],
    b[4] * a[0] + b[5] * a[2] + a[4],
    b[4] * a[1] + b[5] * a[3] + a[5],
  ];
}

export function invert(m: Mat): Mat {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

export const apply = (m: Mat, x: number, y: number) => ({
  x: m[0] * x + m[2] * y + m[4],
  y: m[1] * x + m[3] * y + m[5],
});

/** Нарисовать что-то в системе отображаемой страницы. */
export function inFrame(page: PDFPage, m: Mat, draw: () => void) {
  page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...m));
  draw();
  page.pushOperators(popGraphicsState());
}
