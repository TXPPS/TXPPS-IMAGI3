declare global {
  interface Window {
    /** Bridge installed by the E2E harness so page-level rejections reach the test. */
    __imagi3OnUnhandledRejection?: (text: string) => void;
  }
}

export {};
