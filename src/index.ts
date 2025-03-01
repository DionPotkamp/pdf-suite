import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFObject,
  PDFPage,
  PDFRawStream,
  PDFRef,
  PDFStream,
} from "pdf-lib";

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

// eslint-disable-next-line @typescript-eslint/no-unused-vars
class CombinePdf {
  //@ts-expect-error -- Will be initialized in the public called function
  // This will be the final merged PDF
  private mergedPdf: PDFDocument;
  // Helpers for keeping track of duplicate images and fonts
  private imagesInDoc = new Map<string, PDFRef[]>();
  private firstAddressFontFound: PDFRef | null = null;

  constructor() {}

  /**
   * Combine PDFs. This function will combine PDFs per 1000, and automatically merge the other 1000 asynchronously.
   * @param filenames array of all filenames. This function will fetch the files itself
   */
  public async combinePdfs(filenames: string[]): Promise<Buffer> {
    this.mergedPdf = await PDFDocument.create();
    console.debug(`Combining ${filenames.length} PDFs`);

    let i = 1;
    process.on("exit", () => {
      console.error(
        `Forced to exit after combining ${i}/${filenames.length} PDFs`
      );
    });

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for (const _filename of filenames) {
      // get the PDF
      const pdf = new Uint8Array();
      const document = await PDFDocument.load(pdf);

      await this.dedupePdf(document);
      i++;
    }

    // Save the final PDF
    const finalPdf = Buffer.from((await this.mergedPdf.save()).buffer);
    return finalPdf;
  }

  private async dedupePdf(document: PDFDocument | null): Promise<void> {
    if (document === null) return;
    const lastAddedPages: PDFPage[] = [];
    (
      await this.mergedPdf.copyPages(document, document.getPageIndices())
    ).forEach((page) => {
      lastAddedPages.push(this.mergedPdf.addPage(page));
    });
    document = null; // Let GC handle this on the next sweep

    // Iterate over the pages and find all the images
    for (const page of lastAddedPages) {
      const resources = page.node.Resources();
      if (!resources) continue;
      resources.asMap().forEach((value, key) => {
        this.dedupeImage(key, value);
        this.dedupeFont(key, value);
      });
    }
  }

  private dedupeImage(key: PDFName, value: PDFObject): void {
    if (key !== PDFName.XObject || !(value instanceof PDFDict)) return;

    value.asMap().forEach((possibleDuplicateImageRef, key) => {
      if (!(possibleDuplicateImageRef instanceof PDFRef)) return;

      // This is the original pointer. This pointer need to be replaced with new pointers if it is a duplicate
      const xObject = this.mergedPdf.context.lookup(possibleDuplicateImageRef);

      if (
        !(xObject instanceof PDFRawStream) ||
        xObject.dict.get(PDFName.of("Subtype")) !== PDFName.of("Image")
      )
        return;

      const hash = JSON.stringify({
        width: xObject.dict.get(PDFName.of("Width")),
        height: xObject.dict.get(PDFName.of("Height")),
        length: xObject.dict.get(PDFName.of("Length")),
      });

      if (!this.imagesInDoc.has(hash)) {
        this.imagesInDoc.set(hash, [possibleDuplicateImageRef]);
      } else {
        const existingRefs = this.imagesInDoc.get(hash);
        if (!existingRefs) return;
        existingRefs.forEach((ref) => {
          const existingImage = this.mergedPdf.context.lookup(ref, PDFStream);

          if (
            // @ts-expect-error -- method `equals` does exist, typing of pdf-lib is wrong
            xObject.contents.equals(existingImage.contents)
          ) {
            value.set(key, ref);
            this.mergedPdf.context.delete(possibleDuplicateImageRef);
          }
        });
      }
    });
  }

  private dedupeFont(key: PDFName, value: PDFObject): void {
    if (key !== PDFName.Font || !(value instanceof PDFDict)) return;

    let fontFoundOnPage: PDFRef | undefined;
    value.asMap().forEach((fontPdfRef, key) => {
      if (!(fontPdfRef instanceof PDFRef)) return;

      const font = this.mergedPdf.context.lookup(fontPdfRef, PDFDict);
      if (font.get(PDFName.of("BaseFont")) === PDFName.of("addressFont.ttf")) {
        if (this.firstAddressFontFound === null) {
          this.firstAddressFontFound = fontPdfRef;
        } else if (this.firstAddressFontFound === fontPdfRef) {
          // We can do this check, because it's a pointer
          // Do nothing
        } else {
          // We are sure this is the addressFont.ttf font
          value.set(key, this.firstAddressFontFound);
          fontFoundOnPage = fontPdfRef;
        }
      }
    });

    // Remove
    if (fontFoundOnPage !== undefined) {
      this.removePdfObjectChildrenRecursive(fontFoundOnPage);
    }
  }

  private removePdfObjectChildrenRecursive(
    toRemove: PDFRef | PDFDict | PDFArray
  ): void {
    let objectToRemove = null;

    if (toRemove instanceof PDFRef) {
      objectToRemove = this.mergedPdf.context.lookup(toRemove);
    } else {
      objectToRemove = toRemove;
    }

    if (objectToRemove instanceof PDFRef)
      this.removePdfObjectChildrenRecursive(objectToRemove);

    if (objectToRemove instanceof PDFDict) {
      objectToRemove.asMap().forEach((value) => {
        if (
          value instanceof PDFRef ||
          value instanceof PDFDict ||
          value instanceof PDFArray
        )
          this.removePdfObjectChildrenRecursive(value);
      });
    }

    if (objectToRemove instanceof PDFArray) {
      objectToRemove.asArray().forEach((value) => {
        if (
          value instanceof PDFRef ||
          value instanceof PDFDict ||
          value instanceof PDFArray
        )
          this.removePdfObjectChildrenRecursive(value);
      });
    }

    if (toRemove instanceof PDFRef) this.mergedPdf.context.delete(toRemove);
  }
}
