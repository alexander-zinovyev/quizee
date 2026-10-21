export async function hostingResponse(action: string, work: () => Promise<Response>): Promise<Response> {
  try {
    return await work();
  } catch (error) {
    console.error(`[hosting] ${action} failed`, error);
    return Response.json(
      { message: `${action} failed. Check the server logs for details.` },
      { status: 500 }
    );
  }
}
