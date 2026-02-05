declare module "js-untar" {
  type UntarFile = {
    name: string;
    buffer: ArrayBuffer;
    readAsString?: () => string;
  };
  export default function untar(buffer: ArrayBuffer): Promise<UntarFile[]>;
}
