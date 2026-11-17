import manifest from "@/vendor/moq/manifest.json";

export const MOQ_ELEMENTS_URL = manifest.entry;
export const MOQ_REVISION = manifest.commit;
let loading: Promise<void> | undefined;

/** Await module evaluation, including the pinned entry's asynchronous imports. */
export function ensureMoqElementsLoaded(): Promise<void> {
  if (typeof document === "undefined") return Promise.reject(new Error("MoQ elements require a browser."));
  return loading ??= import(/* webpackIgnore: true */ MOQ_ELEMENTS_URL)
    .then((module: { revision: string }) => {
      if (module.revision !== MOQ_REVISION || !customElements.get("moq-publish") || !customElements.get("moq-watch")) {
        throw new Error("The MoQ module did not register the pinned media elements.");
      }
    })
    .catch((cause: unknown) => {
      throw new Error("Unable to load the MoQ media module.", { cause });
    });
}
