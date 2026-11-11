import { useState } from "react";
import { Platform, Text, View } from "react-native";
import type { MuseApi } from "./api";
import { boxApi, type ReceiptChange } from "./receipt-box-data";
import {
  addDays,
  CATEGORIES,
  isDay,
  KEEP_FOR,
  moneyText,
  parseMoney,
  type Receipt,
  unsureFields,
} from "./receipt-box-logic";
import { ChoiceChip, OutlineButton, TealButton } from "./receipt-box-parts";
import { colors, ErrorNotice, Field, s } from "./ui";

/** A day as a date picker on the web, and a typed YYYY-MM-DD box on a phone app. */
export function DayInput({
  label,
  value,
  onChange,
  unsure,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  unsure?: boolean;
}) {
  if (Platform.OS === "web")
    return (
      <View style={s.field}>
        <Text style={[s.small, { fontWeight: "600", color: colors.text }]}>{label}</Text>
        <input
          aria-label={label}
          type="date"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          style={{
            border: `1.5px solid ${unsure ? colors.amber : colors.line}`,
            borderRadius: 19,
            padding: "12px 16px",
            fontSize: 16,
            color: colors.text,
            background: colors.surface,
            fontFamily: "inherit",
            width: "100%",
            boxSizing: "border-box",
            minHeight: 48,
          }}
        />
      </View>
    );
  return (
    <Field
      label={`${label} (YYYY-MM-DD)`}
      value={value}
      onChangeText={onChange}
      placeholder="2026-11-11"
      autoCapitalize="none"
      keyboardType="numbers-and-punctuation"
      style={unsure ? { borderColor: colors.amber, borderWidth: 1.5 } : undefined}
    />
  );
}

/**
 * Changing a receipt's store, date, total, category, tags, return date or note. Only what really
 * changed is sent (POST /api/receipt-box/:id). A field Neddy wasn't sure of is marked amber.
 */
export function EditForm({
  api,
  receipt,
  onSaved,
  onCancel,
  autoFocus,
  addReturn,
}: {
  api: MuseApi;
  receipt: Receipt;
  onSaved: (receipt: Receipt) => void;
  onCancel: () => void;
  /** Which field starts with the keyboard on it. */
  autoFocus?: "merchant" | "date" | "total" | "returnBy";
  /** Starts with Return window on and the usual 30 days filled in. */
  addReturn?: boolean;
}) {
  const [merchant, setMerchant] = useState(receipt.merchant ?? "");
  const [date, setDate] = useState(receipt.date ?? "");
  const [total, setTotal] = useState(receipt.total === null ? "" : receipt.total.toFixed(2));
  const [category, setCategory] = useState(receipt.category);
  const adding = !!addReturn && !receipt.returnBy;
  const [keepFor, setKeepFor] = useState<string[]>(
    adding && !receipt.keepFor.includes("Return window")
      ? [...receipt.keepFor, "Return window"]
      : receipt.keepFor,
  );
  const [returnBy, setReturnBy] = useState(
    receipt.returnBy ?? (adding && receipt.date ? addDays(receipt.date, 30) : ""),
  );
  const [note, setNote] = useState(receipt.note);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const unsure = unsureFields(receipt);
  const returnOn = keepFor.includes("Return window");

  const toggle = (tag: string) => {
    const on = !keepFor.includes(tag);
    setKeepFor(on ? [...keepFor, tag] : keepFor.filter((item) => item !== tag));
    // A new return window starts at the usual 30 days; they can change it.
    if (tag === "Return window" && on && !returnBy && receipt.date)
      setReturnBy(addDays(receipt.date, 30));
    if (tag === "Return window" && !on) setReturnBy("");
  };

  const save = async () => {
    setError("");
    const change: ReceiptChange = {};
    if (merchant.trim() !== (receipt.merchant ?? "")) {
      if (!merchant.trim()) return setError("The store needs a name.");
      change.merchant = merchant.trim();
    }
    if (date !== (receipt.date ?? "")) {
      if (!isDay(date)) return setError("Choose the date on the receipt.");
      change.date = date;
    }
    const money = total.trim() ? parseMoney(total) : undefined;
    if (total.trim() && money === undefined)
      return setError("The total needs to be a number, like 61.27.");
    // While there are readings to choose between, the total must be sent: sending one is what
    // settles them on the server (the other fields never do).
    const choosing = receipt.candidates.length > 1;
    if (choosing && money === undefined) return setError("Pick the total, or type it.");
    if (money !== undefined && (money !== receipt.total || choosing)) change.total = money;
    if (category !== receipt.category) change.category = category;
    const sameTags =
      keepFor.length === receipt.keepFor.length &&
      keepFor.every((tag) => receipt.keepFor.includes(tag));
    if (!sameTags) change.keepFor = keepFor;
    if (returnOn) {
      if (!isDay(returnBy)) return setError("Add the return-by date, or turn off Return window.");
      if (returnBy !== receipt.returnBy) change.returnBy = returnBy;
    } else if (receipt.returnBy) change.returnBy = null;
    if (note.trim() !== receipt.note) change.note = note.trim();
    if (!Object.keys(change).length) return onCancel();
    setBusy(true);
    try {
      onSaved(await boxApi.update(api, receipt.id, change));
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Couldn’t save that. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const marked = (field: "merchant" | "date" | "total") =>
    unsure.has(field) ? { borderColor: colors.amber, borderWidth: 1.5 } : undefined;

  return (
    <View style={{ gap: 4 }}>
      <Field
        label="Store"
        value={merchant}
        onChangeText={setMerchant}
        placeholder="Where you bought it"
        autoFocus={autoFocus === "merchant"}
        style={marked("merchant")}
      />
      <DayInput label="Date" value={date} onChange={setDate} unsure={unsure.has("date")} />
      {receipt.candidates.length > 1 && (
        <View style={s.field}>
          <Text style={[s.small, { fontWeight: "600", color: colors.text }]}>
            Which total is right?
          </Text>
          <View
            role="radiogroup"
            aria-label="Which total is right?"
            style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}
          >
            {receipt.candidates.map((value) => (
              <ChoiceChip
                key={value}
                radio
                label={moneyText(value, receipt.currency)}
                selected={parseMoney(total) === value}
                onPress={() => setTotal(value.toFixed(2))}
              />
            ))}
          </View>
        </View>
      )}
      <Field
        label={`Total (${receipt.currency})`}
        value={total}
        onChangeText={setTotal}
        placeholder={moneyText(61.27, receipt.currency)}
        keyboardType="decimal-pad"
        autoFocus={autoFocus === "total"}
        style={marked("total")}
      />
      <View style={s.field}>
        <Text style={[s.small, { fontWeight: "600", color: colors.text }]}>Category</Text>
        <View
          role="radiogroup"
          aria-label="Category"
          style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}
        >
          {CATEGORIES.map((name) => (
            <ChoiceChip
              key={name}
              radio
              dot={name}
              label={name}
              selected={category === name}
              onPress={() => setCategory(name)}
            />
          ))}
        </View>
      </View>
      <View style={s.field}>
        <Text style={[s.small, { fontWeight: "600", color: colors.text }]}>
          Keep it for (optional)
        </Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {KEEP_FOR.map((tag) => (
            <ChoiceChip
              key={tag}
              label={tag}
              selected={keepFor.includes(tag)}
              onPress={() => toggle(tag)}
            />
          ))}
        </View>
      </View>
      {returnOn && <DayInput label="Return by" value={returnBy} onChange={setReturnBy} />}
      <Field
        label="Note"
        value={note}
        onChangeText={setNote}
        placeholder="Anything to remember about it"
        maxLength={300}
      />
      <ErrorNotice error={error} />
      <View style={{ gap: 10, marginTop: 4 }}>
        <TealButton id="save-edit" label="Save changes" onPress={() => void save()} busy={busy} />
        <OutlineButton onPress={onCancel} disabled={busy}>
          Cancel
        </OutlineButton>
      </View>
    </View>
  );
}
