import { DISPLAY_TIME_ZONE } from "@/app-clock";

/** When a Decision log or access log entry happened, such as "Fri 20 Nov, 9:00 am", in the bank's time zone. */
export const entryTimeFormat = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
  timeZone: DISPLAY_TIME_ZONE,
});
