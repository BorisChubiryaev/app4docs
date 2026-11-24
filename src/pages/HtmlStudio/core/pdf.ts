// The PDF renderer runs inside the document's opaque sandbox, including when
// the source builds its charts with JavaScript. Only the finished file leaves it.
import htmlToImage from "html-to-image/dist/html-to-image.js?raw";
import jsPDF from "jspdf/dist/jspdf.umd.min.js?raw";
import font from "../../PdfToWord/word2pdf/LiberationSans-Regular.ttf?inline";
import capture from "./pdfFrame.js?raw";

export function generatePdf(
  html: string, width: number, height: number, signal: AbortSignal,
  progress: (message: string) => void,
): Promise<Blob> {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const script = doc.createElement("script");
  // Keep the renderer and its libraries out of the source page's global scope.
  const library = (source: string) => "(() => { const exports = {}, module = { exports };\n" + source + "\nreturn module.exports; })()";
  script.textContent = ("(() => { document.currentScript.remove();\nconst renderer = " + library(htmlToImage) +
    ";\nconst { jsPDF } = " + library(jsPDF) + ";\nconst font = " +
    JSON.stringify(font.slice(font.indexOf(",") + 1)) + ";\n" + capture + "\n})();").replace(/<\/script/gi, "<\\/script");
  doc.head.prepend(script);
  const frame = document.createElement("iframe");
  frame.setAttribute("sandbox", "allow-scripts");
  frame.setAttribute("aria-hidden", "true");
  frame.tabIndex = -1;
  frame.inert = true;
  frame.style.cssText = `position:fixed;left:0;top:0;z-index:-1;opacity:0;border:0;pointer-events:none;width:${width}px;height:${height}px`;
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>;
    function cleanup() {
      clearTimeout(timer);
      window.removeEventListener("message", receive);
      signal.removeEventListener("abort", abort);
      frame.remove();
    }
    function abort() {
      cleanup();
      reject(new DOMException("Отменено", "AbortError"));
    }
    function armTimeout() {
      clearTimeout(timer);
      timer = setTimeout(() => {
        cleanup();
        reject(new Error("Время подготовки PDF истекло. Проверьте, загрузились ли картинки и графики в просмотре."));
      }, 60000);
    }
    function receive(event: MessageEvent) {
      if (event.source !== frame.contentWindow || event.origin !== "null" || event.data?.type !== "html-studio-pdf") return;
      const { stage, blob, error } = event.data;
      if (typeof stage === "string") {
        armTimeout();
        progress(stage);
      } else if (blob instanceof Blob && blob.type === "application/pdf") {
        cleanup();
        resolve(blob);
      } else if (typeof error === "string") {
        cleanup();
        reject(new Error(error));
      }
    }
    if (signal.aborted) return abort();
    signal.addEventListener("abort", abort, { once: true });
    window.addEventListener("message", receive);
    armTimeout();
    frame.srcdoc = (doc.doctype ? new XMLSerializer().serializeToString(doc.doctype) : "") + doc.documentElement.outerHTML;
    document.body.appendChild(frame);
  });
}
