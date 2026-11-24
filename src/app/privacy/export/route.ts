import { getAppBank } from "@/app-bank";
import { localDateOf } from "@/calendar";
import { requireCustomer } from "@/session";

/**
 * Export: downloads one JSON file of everything Plinth holds about the signed-in customer, after writing its access
 * log entry. A POST, so a link prefetch can't write an entry.
 */
export async function POST(): Promise<Response> {
  const customer = await requireCustomer();
  const bank = getAppBank();
  const file = bank.buildExport(customer);
  const filename = `plinth-export-${localDateOf(bank.clock.now())}.json`;
  return new Response(`${JSON.stringify(file, null, 2)}\n`, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
