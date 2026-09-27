import { ChevronRight, UserRound, UsersRound } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Button, Card, colors, ErrorNotice, Field, SectionHeading, s } from "./ui";
import { useWorkspace } from "./workspace";

interface PersonNote {
  id: string;
  name: string;
  kind: "person" | "group";
  relation?: string;
  emails: string[];
  notes: string;
  updatedAt: string;
}
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The pages Neddy keeps on the people and groups you deal with, which you can read and correct. */
export function PeopleNotesCard() {
  const { api, notify } = useWorkspace();
  const [people, setPeople] = useState<PersonNote[]>();
  const [open, setOpen] = useState<string>();
  const [adding, setAdding] = useState(false);
  const load = useCallback(
    () =>
      api.request<{ people: PersonNote[] }>("/api/people").then(
        (value) => setPeople(value.people),
        () => setPeople([]),
      ),
    [api],
  );
  useEffect(() => {
    void load();
  }, [load]);
  if (!people) return null;
  return (
    <Card style={{ gap: 12 }}>
      <SectionHeading title="People & groups" />
      <Text style={s.muted}>
        A page on each person and group in your life: who they are to you, their email, and things
        worth remembering. Your agent adds to them as it learns, and reads them before it writes to
        someone.
      </Text>
      {people.map((person) =>
        open === person.id ? (
          <PersonEditor
            key={person.id}
            person={person}
            onDone={(text) => {
              setOpen(undefined);
              if (text) notify(text);
              void load();
            }}
          />
        ) : (
          <Pressable
            key={person.id}
            accessibilityRole="button"
            accessibilityLabel={`Open ${person.name}`}
            onPress={() => setOpen(person.id)}
            style={({ pressed }) => [
              s.row,
              {
                gap: 12,
                paddingVertical: 10,
                borderTopWidth: 1,
                borderTopColor: colors.line,
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          >
            {person.kind === "group" ? (
              <UsersRound size={20} color={colors.muted} />
            ) : (
              <UserRound size={20} color={colors.muted} />
            )}
            <View style={{ flex: 1 }}>
              <Text style={[s.text, { fontWeight: "600" }]}>{person.name}</Text>
              {!!person.relation && <Text style={s.small}>{person.relation}</Text>}
            </View>
            <ChevronRight size={18} color={colors.muted} />
          </Pressable>
        ),
      )}
      {!people.length && !adding && (
        <Text style={s.small}>No pages yet. They appear as you mention people in chat.</Text>
      )}
      {adding ? (
        <AddPerson
          onDone={(text) => {
            setAdding(false);
            if (text) notify(text);
            void load();
          }}
        />
      ) : (
        <Button small onPress={() => setAdding(true)}>
          Add someone
        </Button>
      )}
    </Card>
  );
}

function AddPerson({ onDone }: { onDone: (message?: string) => void }) {
  const { api } = useWorkspace();
  const [name, setName] = useState("");
  const [relation, setRelation] = useState("");
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save() {
    setBusy(true);
    setError("");
    try {
      await api.request("/api/people", {
        name: name.trim(),
        ...(relation.trim() ? { relation: relation.trim() } : {}),
        ...(email.trim() ? { email: email.trim() } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      onDone(`Added ${name.trim()}.`);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <View style={{ gap: 8 }}>
      <Field label="Name" value={name} onChangeText={setName} placeholder="Dana Ruiz" />
      <Field
        label="Who they are to you"
        value={relation}
        onChangeText={setRelation}
        placeholder="Client at Acme, my sister, book club"
      />
      <Field
        label="Email (optional)"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
      />
      <Field
        label="Worth remembering (optional)"
        value={note}
        onChangeText={setNote}
        placeholder="Prefers calls before 10am"
      />
      <View style={[s.row, { gap: 8 }]}>
        <Button small primary busy={busy} disabled={!name.trim()} onPress={() => void save()}>
          Add
        </Button>
        <Button small onPress={() => onDone()}>
          Cancel
        </Button>
      </View>
      <ErrorNotice error={error} />
    </View>
  );
}

function PersonEditor({
  person,
  onDone,
}: {
  person: PersonNote;
  onDone: (message?: string) => void;
}) {
  const { api } = useWorkspace();
  const [name, setName] = useState(person.name);
  const [relation, setRelation] = useState(person.relation ?? "");
  const [emails, setEmails] = useState(person.emails.join(", "));
  const [notes, setNotes] = useState(person.notes);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  async function run(id: string, work: () => Promise<string>) {
    setBusy(id);
    setError("");
    try {
      onDone(await work());
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy("");
    }
  }
  return (
    <View style={{ gap: 8, paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.line }}>
      <Field label="Name" value={name} onChangeText={setName} />
      <Field label="Who they are to you" value={relation} onChangeText={setRelation} />
      <Field
        label="Emails"
        value={emails}
        onChangeText={setEmails}
        autoCapitalize="none"
        placeholder="Separate several with commas"
      />
      <Field label="Notes" value={notes} onChangeText={setNotes} multiline />
      <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
        <Button
          small
          primary
          busy={busy === "save"}
          disabled={!name.trim() || !!busy}
          onPress={() =>
            void run("save", async () => {
              await api.request(`/api/people/${person.id}`, {
                name: name.trim(),
                kind: person.kind,
                relation: relation.trim(),
                emails: emails
                  .split(/[,\s]+/)
                  .map((e) => e.trim())
                  .filter(Boolean),
                notes,
              });
              return "Saved.";
            })
          }
        >
          Save
        </Button>
        <Button small disabled={!!busy} onPress={() => onDone()}>
          Close
        </Button>
        <Button
          small
          danger
          busy={busy === "delete"}
          disabled={!!busy}
          onPress={() =>
            void run("delete", async () => {
              await api.request(`/api/people/${person.id}/delete`, {});
              return `Removed ${person.name}.`;
            })
          }
        >
          Delete page
        </Button>
      </View>
      <ErrorNotice error={error} />
    </View>
  );
}
