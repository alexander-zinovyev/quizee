import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";

export async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

export async function startApp(port: number, projectId: string): Promise<ChildProcess> {
  const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(port)], {
    env: { ...process.env, FIREBASE_STORAGE_BUCKET: `${projectId}.appspot.com`, QUIZEE_NEXT_DIST_DIR: ".next", FIREBASE_PROJECT_ID: projectId,
      NEXT_PUBLIC_FIREBASE_PROJECT_ID: projectId, NEXT_PUBLIC_FIREBASE_API_KEY: "fake",
      NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: `${projectId}.firebaseapp.com`, NEXT_PUBLIC_FIREBASE_APP_ID: "sorting-http-test" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise<void>((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => { child.kill("SIGTERM"); reject(new Error(`Next server did not become ready: ${output}`)); }, 30000);
    child.once("error", (error) => { clearTimeout(timeout); reject(error); });
    child.once("exit", (code) => { clearTimeout(timeout); reject(new Error(`Next exited before readiness (${code}): ${output}`)); });
    const receive = (chunk: Buffer) => {
      output = `${output}${chunk}`.slice(-6000);
      if (output.includes("Ready in")) { clearTimeout(timeout); resolve(); }
    };
    child.stdout!.on("data", receive); child.stderr!.on("data", receive);
  });
  return child;
}

