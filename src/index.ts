import { PDFDocument } from "pdf-lib";

import * as pdfjsLib from "pdfjs-dist";
import Sortable from "sortablejs";

// file id -> File object
let fileMap: Record<string, File> = {};
let fileIdCounter = 0;
let initialized = false;

interface State {
  loading: boolean;
}

const state = new Proxy<State>(
  { loading: true },
  {
    set(target, property: keyof State, value) {
      if (!initialized) {
        console.warn("DOM not initialized yet");
        return false;
      }

      target[property] = value;
      if (property === "loading") toggleLoading(value);

      return true;
    },
  }
);

const toggleLoading = (value: boolean) => {
  mergeBtn.disabled = value;
  fileInput.disabled = value;
  compressCheckbox.disabled = value;
  qualitySlider.disabled = value;

  sortable.option("disabled", value);
  fileList.style.opacity = value ? "0.5" : "1";
  mergeBtn.innerHTML = value
    ? '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Merging...'
    : "Merge PDFs in Order";
};

// References to DOM elements
let fileNameInput: HTMLInputElement;
let fileInput: HTMLInputElement;
let fileList: HTMLUListElement;
let fileListCard: HTMLElement;
let mergeBtn: HTMLButtonElement;
let compressCheckbox: HTMLInputElement;
let qualityContainer: HTMLElement;
let qualitySlider: HTMLInputElement;
let qualityValue: HTMLElement;
let sortable: Sortable;

document.addEventListener("DOMContentLoaded", () => {
  pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf-worker.mjs";

  // Set references to DOM elements
  fileNameInput = document.getElementById("fileNameInput") as HTMLInputElement;
  fileInput = document.getElementById("fileInput") as HTMLInputElement;
  fileList = document.getElementById("fileList") as HTMLUListElement;
  fileListCard = document.getElementById("fileListCard") as HTMLElement;
  mergeBtn = document.getElementById("mergeBtn") as HTMLButtonElement;
  compressCheckbox = document.getElementById(
    "compressCheckbox"
  ) as HTMLInputElement;
  qualityContainer = document.getElementById("qualityContainer") as HTMLElement;
  qualitySlider = document.getElementById("qualitySlider") as HTMLInputElement;
  qualityValue = document.getElementById("qualityValue") as HTMLElement;

  // Initialize SortableJS on the file list for drag-and-drop reordering
  sortable = Sortable.create(fileList, {
    handle: ".draggable",
    animation: 150,
  });

  // Show/hide quality slider when the compress checkbox is toggled
  compressCheckbox.addEventListener("change", () => {
    qualityContainer.style.display = compressCheckbox.checked
      ? "block"
      : "none";
    qualityValue.textContent = qualitySlider.value;
  });

  // Update quality value display as the slider moves
  qualitySlider.addEventListener("input", () => {
    qualityValue.textContent = qualitySlider.value;
  });

  // When files are selected, populate the reorderable list
  fileInput.addEventListener("change", populatePdfList);

  // When the "Merge PDFs in Order" button is clicked, merge the files in the user-defined order.
  mergeBtn.addEventListener("click", combinePdfs);

  initialized = true;
  state.loading = false;
});

async function populatePdfList(): Promise<void> {
  fileList.innerHTML = "";
  fileMap = {};
  fileIdCounter = 0;

  const files = Array.from(fileInput.files || []);

  files.forEach((file) => {
    const id = "file-" + fileIdCounter++;
    fileMap[id] = file;
    // Create a list-group item with a drag handle icon
    const li = document.createElement("li");
    li.className =
      "list-group-item d-flex justify-content-between align-items-center draggable";
    li.setAttribute("data-id", id);
    li.innerHTML = `<span>${file.name}</span> <img src="move.svg" alt="Drag handle">`;
    fileList.appendChild(li);
  });

  mergeBtn.style.display = "inline-block";
  fileListCard.style.display = files.length < 2 ? "none" : "block";
}

async function combinePdfs(): Promise<void> {
  if (state.loading) return;
  state.loading = true;
  const filesSelected = Object.keys(fileMap).length;
  const listItems = Array.from(fileList.querySelectorAll("li"));
  const useCompression = compressCheckbox.checked;
  const qualityFraction = parseFloat(qualitySlider.value ?? "100") / 100;

  const totalSize = Object.values(fileMap).reduce(
    (acc, file) => acc + file.size,
    0
  );
  if (totalSize > 10 * 1024 * 1024 * 1024)
    // 10 GB
    return alert("Total size of files is too large to merge.");

  if (listItems.length === 0 && filesSelected === 0)
    return alert("No files to merge.");

  if (useCompression && (qualityFraction <= 0 || qualityFraction > 1))
    return alert("Compression quality must be between 1 and 100.");

  const mergedPdf = await PDFDocument.create();

  // Process each file in the order shown in the list
  for (const li of listItems) {
    const id = li.getAttribute("data-id");
    if (!id) continue;
    const file = fileMap[id];

    if (useCompression) {
      // Use pdf.js to render and compress each page as JPEG
      const pagesImages = await processPdfWithCompression(
        file,
        qualityFraction
      );
      for (const { width, height, dataUrl } of pagesImages) {
        mergedPdf
          .addPage([width, height])
          .drawImage(await mergedPdf.embedJpg(dataUrl), {
            x: 0,
            y: 0,
            width,
            height,
          });
      }
    } else {
      const pdf = await PDFDocument.load(await file.arrayBuffer());
      const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
      copiedPages.forEach((page) => mergedPdf.addPage(page));
    }
  }

  const fileName = fileNameInput.value === "" ? "merged" : fileNameInput.value;
  await savePdf(mergedPdf, `${fileName}.pdf`);
  state.loading = false;
}

async function processPdfWithCompression(
  file: File,
  quality: number
): Promise<Array<{ dataUrl: string; width: number; height: number }>> {
  const loadingTask = pdfjsLib.getDocument({ data: await file.arrayBuffer() });
  const pdf = await loadingTask.promise;
  const pagesImages: Array<{ dataUrl: string; width: number; height: number }> =
    [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 1 });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const context = canvas.getContext("2d");
    if (context) {
      await page.render({ canvasContext: context, viewport: viewport }).promise;
      const dataUrl = canvas.toDataURL("image/jpeg", quality);
      pagesImages.push({ dataUrl, width: canvas.width, height: canvas.height });
    }
  }

  return pagesImages;
}

async function savePdf(pdf: PDFDocument, filename: string): Promise<void> {
  const mergedPdfBytes = await pdf.save();
  const blob = new Blob([mergedPdfBytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);

  // Trigger a download of the PDF
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
