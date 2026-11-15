import { GlobalDocuments } from "./global_documents";
import { TEST_RUNNER } from "@selfage/puppeteer_test_runner";
import { assertThat, eq } from "@selfage/test_matcher";

function createDocument(): Document {
  return document.implementation.createHTMLDocument("test");
}

TEST_RUNNER.run({
  name: "GlobalDocumentsTest",
  cases: [
    {
      name: "HideWhenMousedownOnInitialDocument",
      execute: () => {
        // Prepare
        let initialDocument = createDocument();
        let globalDocuments = GlobalDocuments.create([initialDocument]);
        let hidden = 0;
        globalDocuments.hideWhenMousedown(() => hidden++);

        // Execute
        initialDocument.dispatchEvent(new MouseEvent("mousedown"));

        // Verify
        assertThat(hidden, eq(1), "hidden count");
      },
    },
    {
      name: "AddedDocumentGetsHandlersRegisteredBeforeIt",
      execute: () => {
        // Prepare
        let globalDocuments = GlobalDocuments.create([]);
        let hidden = 0;
        let keys = new Array<string>();
        globalDocuments.hideWhenMousedown(() => hidden++);
        globalDocuments.onKeydown((event) => keys.push(event.key));
        let addedDocument = createDocument();

        // Execute
        globalDocuments.addDocument(addedDocument);
        addedDocument.dispatchEvent(new MouseEvent("mousedown"));
        addedDocument.body.dispatchEvent(
          new KeyboardEvent("keydown", { key: "a" }),
        );

        // Verify
        assertThat(hidden, eq(1), "hidden count");
        assertThat(keys.join(","), eq("a"), "keys");
      },
    },
    {
      name: "AddedDocumentGetsHandlersRegisteredAfterIt",
      execute: () => {
        // Prepare
        let globalDocuments = GlobalDocuments.create([]);
        let addedDocument = createDocument();
        globalDocuments.addDocument(addedDocument);
        let hidden = 0;
        globalDocuments.hideWhenMousedown(() => hidden++);

        // Execute
        addedDocument.dispatchEvent(new MouseEvent("mousedown"));

        // Verify
        assertThat(hidden, eq(1), "hidden count");
      },
    },
    {
      name: "RemovedDocumentIsNoLongerGivenNewHandlers",
      execute: () => {
        // Prepare
        let globalDocuments = GlobalDocuments.create([]);
        let removedDocument = createDocument();
        let keptDocument = createDocument();
        globalDocuments.addDocument(removedDocument);
        globalDocuments.addDocument(keptDocument);
        globalDocuments.removeDocument(removedDocument);
        let hidden = 0;
        globalDocuments.hideWhenMousedown(() => hidden++);

        // Execute
        removedDocument.dispatchEvent(new MouseEvent("mousedown"));
        keptDocument.dispatchEvent(new MouseEvent("mousedown"));

        // Verify
        assertThat(hidden, eq(1), "hidden count");
      },
    },
    {
      name: "EachDocumentTriggersTheHandlerOnce",
      execute: () => {
        // Prepare
        let initialDocument = createDocument();
        let addedDocument = createDocument();
        let globalDocuments = GlobalDocuments.create([initialDocument]);
        let hidden = 0;
        globalDocuments.hideWhenMousedown(() => hidden++);
        globalDocuments.addDocument(addedDocument);

        // Execute
        initialDocument.dispatchEvent(new MouseEvent("mousedown"));
        addedDocument.dispatchEvent(new MouseEvent("mousedown"));

        // Verify
        assertThat(hidden, eq(2), "hidden count");
      },
    },
  ],
});
