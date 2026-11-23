import { redirect } from "next/navigation";
import { getAppBank } from "@/app-bank";
import { startSession } from "@/session";

export const dynamic = "force-dynamic";

async function signInAs(formData: FormData) {
  "use server";
  const customer = getAppBank().signIn(Number(formData.get("customerId")));
  await startSession(customer);
  redirect("/");
}

export default function SignInPage() {
  const customers = getAppBank().listCustomers();
  return (
    <main className="page narrow">
      <h1>Sign in as</h1>
      <p className="muted">Pick a seeded customer. All money is imaginary.</p>
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
