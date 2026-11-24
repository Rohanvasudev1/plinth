import { redirect } from "next/navigation";
import { getAppBank } from "@/app-bank";
import { ClosedCustomerError } from "@/bank";
import type { Customer } from "@/customer-data";
import { startSession } from "@/session";

export const dynamic = "force-dynamic";

async function signInAs(formData: FormData) {
  "use server";
  let customer: Customer;
  try {
    customer = getAppBank().signIn(Number(formData.get("customerId")));
  } catch (error) {
    if (!(error instanceof ClosedCustomerError)) throw error;
    redirect("/sign-in?closed=1");
  }
  await startSession(customer);
  redirect("/");
}

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ closed?: string | string[] }> }) {
  const customers = getAppBank().listCustomers();
  const closed = (await searchParams).closed !== undefined;
  return (
    <main className="page narrow">
      <h1>Sign in as</h1>
      <p className="muted">Pick a seeded customer. All money is imaginary.</p>
      {closed && (
        <p className="card result refused" role="alert">
          This account is closed
        </p>
      )}
      <form action={signInAs} className="customer-list">
        {customers.map((customer) => (
          <button key={customer.id} type="submit" name="customerId" value={customer.id} className="customer">
            {customer.name}
          </button>
        ))}
      </form>
    </main>
  );
}
