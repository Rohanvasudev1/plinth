import { getAppClock } from "@/app-clock";

export const dynamic = "force-dynamic";

const dateFormat = new Intl.DateTimeFormat("en-GB", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});

export default function HomePage() {
  const today = getAppClock().now();
  return (
    <main>
      <h1>Home</h1>
      <p>{dateFormat.format(today)}</p>
      <p>Plinth is being built. All money is imaginary.</p>
    </main>
  );
}
