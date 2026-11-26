// Intentional unhandled promise rejection
async function fetchInventory(sku: string): Promise<number> {
  await Bun.sleep(10);
  throw new Error(`Inventory service timeout for SKU=${sku}`);
}

async function checkout() {
  const qty = await fetchInventory("SKU-9981");
  console.log("Reserved:", qty);
}

void checkout();
