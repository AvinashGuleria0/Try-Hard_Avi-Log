import { captureError } from "../packages/avilog/src/index.js";

async function simulateExpressRoute() {
  try {
    const payload: Record<string, unknown> = {};
    // Intentional bug: calling .split on undefined
    return (payload.token as string).split(".");
  } catch (err) {
    const result = await captureError(err, {
      target: "cursor",
      copyClipboard: false
    });
    console.log("SDK captured root cause:", result.diagnosis.rootCauseTitle);
    console.log("SDK reduction:", `${result.compacted.reductionPercent}%`);
  }
}

await simulateExpressRoute();
