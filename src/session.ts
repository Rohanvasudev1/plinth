import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getAppBank } from "./app-bank";
import type { Customer } from "./customer-data";

const SESSION_COOKIE = "plinth_customer";

/** Remembers the signed-in customer in a session cookie. Sign-in is a fake picker, not real identity. */
export async function startSession(customer: Customer): Promise<void> {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, String(customer.id), { httpOnly: true, sameSite: "lax", path: "/" });
}

/** The signed-in customer, or a redirect to "Sign in as" when there is none. */
export async function requireCustomer(): Promise<Customer> {
  const jar = await cookies();
  const customerId = Number(jar.get(SESSION_COOKIE)?.value);
  const customer = Number.isSafeInteger(customerId)
    ? getAppBank().systemData.findCustomer(customerId)
    : undefined;
  if (!customer) redirect("/sign-in");
  return customer;
}
