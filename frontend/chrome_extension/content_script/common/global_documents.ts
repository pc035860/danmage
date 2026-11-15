export class GlobalDocuments {
  public static create(documents: Document[]): GlobalDocuments {
    return new GlobalDocuments(documents);
  }

  private mousedownHandlers = new Array<() => void>();
  private keydownCallbacks = new Array<(event: KeyboardEvent) => void>();

  public constructor(private documents: Document[]) {}

  public hideWhenMousedown(hide: () => void): void {
    this.mousedownHandlers.push(hide);
    for (let document of this.documents) {
      this.listenToMousedown(document, hide);
    }
  }

  public onKeydown(callback: (event: KeyboardEvent) => void): void {
    this.keydownCallbacks.push(callback);
    for (let document of this.documents) {
      this.listenToKeydown(document, callback);
    }
  }

  // For documents that come and go after the handlers were registered, e.g.
  // YouTube's chat iframe, which gets a new document every time it is rebuilt.
  // A removed document is just no longer tracked; the page discards it.
  public removeDocument(document: Document): void {
    this.documents = this.documents.filter((tracked) => tracked !== document);
  }

  public addDocument(document: Document): void {
    this.documents.push(document);
    this.mousedownHandlers.forEach((hide) =>
      this.listenToMousedown(document, hide),
    );
    this.keydownCallbacks.forEach((callback) =>
      this.listenToKeydown(document, callback),
    );
  }

  private listenToMousedown(document: Document, hide: () => void): void {
    document.addEventListener("mousedown", () => {
      hide();
    });
  }

  private listenToKeydown(
    document: Document,
    callback: (event: KeyboardEvent) => void,
  ): void {
    document.body.addEventListener("keydown", (event) => callback(event));
  }
}
