/**
 * A contact card (vCard) for the agent's own email address. Saved to the person's contacts, it
 * makes Gmail and Outlook fill in the address when they type the agent's name, so forwarding
 * mail to it never depends on remembering the address.
 */
export function contactCard(name: string, address: string) {
  const clean = (value: string) =>
    value
      .replace(/[\r\n,;\\]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  return `${[
    "BEGIN:VCARD",
    "VERSION:3.0",
    `FN:${clean(name) || "Neddy"}`,
    `N:;${clean(name) || "Neddy"};;;`,
    `EMAIL;TYPE=INTERNET:${address.replace(/[\r\n\s]/g, "")}`,
    "NOTE:Forward or send email here to hand it work.",
    "END:VCARD",
  ].join("\r\n")}\r\n`;
}

/** A file name for the card: "neddy.vcf". */
export function contactFileName(name: string) {
  return `${
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "neddy"
  }.vcf`;
}
