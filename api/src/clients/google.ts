import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? "";
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? "";
const REDIRECT_URI = "https://api.jkrumm.com/oauth/google/callback";
const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar.readonly",
].join(" ");

const DATA_DIR = process.env.DATA_DIR ?? "./data";
const TOKEN_FILE = join(DATA_DIR, "oauth-tokens.json");

interface GoogleTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // unix ms
}

interface TokenStore {
  google?: GoogleTokens;
}

function loadTokens(): TokenStore {
  if (!existsSync(TOKEN_FILE)) return {};
  return JSON.parse(readFileSync(TOKEN_FILE, "utf-8")) as TokenStore;
}

function saveTokens(store: TokenStore): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(TOKEN_FILE, JSON.stringify(store, null, 2));
}

export function getAuthUrl(): string {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: SCOPES,
    access_type: "offline",
    prompt: "consent",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export async function exchangeCode(code: string): Promise<void> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) throw new Error(`Token exchange failed: ${await res.text()}`);
  const data = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };
  const store = loadTokens();
  store.google = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  saveTokens(store);
}

async function refreshAccessToken(tokens: GoogleTokens): Promise<GoogleTokens> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: tokens.refreshToken,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`Token refresh failed: ${await res.text()}`);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  return {
    accessToken: data.access_token,
    refreshToken: tokens.refreshToken,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
}

async function getValidAccessToken(): Promise<string> {
  const store = loadTokens();
  if (!store.google)
    throw new Error("Google not authenticated — visit /oauth/google/init in a browser");
  let tokens = store.google;
  if (Date.now() >= tokens.expiresAt - 5 * 60 * 1000) {
    tokens = await refreshAccessToken(tokens);
    store.google = tokens;
    saveTokens(store);
  }
  return tokens.accessToken;
}

// ---------- Gmail ----------

interface GmailMessage {
  id: string;
  threadId: string;
}

interface GmailMessageDetail {
  id: string;
  payload: {
    headers: Array<{ name: string; value: string }>;
    parts?: GmailPart[];
    body?: { data?: string; size: number };
    mimeType: string;
  };
  snippet: string;
  labelIds: string[];
}

interface GmailPart {
  mimeType: string;
  body: { data?: string; attachmentId?: string; size: number };
  parts?: GmailPart[];
  filename?: string;
}

function getHeader(
  headers: Array<{ name: string; value: string }>,
  name: string,
): string {
  return (
    headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ??
    ""
  );
}

function parseAddress(raw: string): { name: string; email: string } {
  const match = raw.match(/^(.+?)\s*<([^>]+)>$/);
  if (match) return { name: match[1].trim(), email: match[2].trim() };
  return { name: "", email: raw.trim() };
}

function parseAddressList(
  raw: string,
): Array<{ name: string; email: string }> {
  return raw
    .split(",")
    .map((s) => parseAddress(s.trim()))
    .filter((a) => a.email);
}

function decodeBase64Url(data: string): string {
  return Buffer.from(
    data.replace(/-/g, "+").replace(/_/g, "/"),
    "base64",
  ).toString("utf-8");
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function extractBodyAndAttachments(payload: GmailMessageDetail["payload"]): {
  body: string;
  attachments: Array<{ filename: string; mimeType: string; size: number }>;
} {
  const attachments: Array<{
    filename: string;
    mimeType: string;
    size: number;
  }> = [];

  function findBody(
    parts: GmailPart[] | undefined,
    mime: string,
  ): string | null {
    if (!parts) return null;
    for (const part of parts) {
      if (part.mimeType === mime && part.body.data)
        return decodeBase64Url(part.body.data);
      if (part.mimeType.startsWith("multipart/")) {
        const found = findBody(part.parts, mime);
        if (found) return found;
      }
    }
    return null;
  }

  function collectAttachments(parts: GmailPart[] | undefined): void {
    if (!parts) return;
    for (const part of parts) {
      if (part.filename && part.body.attachmentId) {
        attachments.push({
          filename: part.filename,
          mimeType: part.mimeType,
          size: part.body.size,
        });
      }
      if (part.parts) collectAttachments(part.parts);
    }
  }

  let body = "";
  if (payload.parts) {
    const plain = findBody(payload.parts, "text/plain");
    if (plain) {
      body = plain;
    } else {
      const html = findBody(payload.parts, "text/html");
      body = html ? stripHtml(html) : "";
    }
    collectAttachments(payload.parts);
  } else if (payload.body?.data) {
    const raw = decodeBase64Url(payload.body.data);
    body = payload.mimeType === "text/html" ? stripHtml(raw) : raw;
  }

  return { body, attachments };
}

export interface EmailListItem {
  id: string;
  subject: string;
  from: { name: string; email: string };
  to: Array<{ name: string; email: string }>;
  date: string;
  snippet: string;
  isRead: boolean;
  labels: string[];
  hasAttachments: boolean;
}

export interface EmailDetail extends EmailListItem {
  body: string;
  attachments: Array<{ filename: string; mimeType: string; size: number }>;
}

export async function listEmails(params: {
  days?: number;
  maxResults?: number;
  query?: string;
}): Promise<EmailListItem[]> {
  const token = await getValidAccessToken();
  const days = params.days ?? 7;
  const maxResults = params.maxResults ?? 50;

  const after = Math.floor((Date.now() - days * 86400 * 1000) / 1000);
  let q = `in:inbox -category:spam -category:promotions -category:social after:${after}`;
  if (params.query) q += ` ${params.query}`;

  const listRes = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${maxResults}&q=${encodeURIComponent(q)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!listRes.ok) throw new Error(`Gmail list failed: ${await listRes.text()}`);
  const listData = (await listRes.json()) as { messages?: GmailMessage[] };
  if (!listData.messages?.length) return [];

  const details = await Promise.all(
    listData.messages.map(async (m) => {
      const r = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata` +
          `&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!r.ok) return null;
      return r.json() as Promise<GmailMessageDetail>;
    }),
  );

  return details
    .filter((d): d is GmailMessageDetail => d !== null)
    .map((d) => {
      const h = d.payload.headers;
      return {
        id: d.id,
        subject: getHeader(h, "Subject"),
        from: parseAddress(getHeader(h, "From")),
        to: parseAddressList(getHeader(h, "To")),
        date: getHeader(h, "Date"),
        snippet: d.snippet,
        isRead: !d.labelIds.includes("UNREAD"),
        labels: d.labelIds,
        hasAttachments: d.labelIds.includes("HAS_ATTACHMENT"),
      };
    });
}

export async function getEmail(id: string): Promise<EmailDetail> {
  const token = await getValidAccessToken();
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`Gmail get failed: ${await res.text()}`);
  const d = (await res.json()) as GmailMessageDetail;
  const h = d.payload.headers;
  const { body, attachments } = extractBodyAndAttachments(d.payload);

  return {
    id: d.id,
    subject: getHeader(h, "Subject"),
    from: parseAddress(getHeader(h, "From")),
    to: parseAddressList(getHeader(h, "To")),
    date: getHeader(h, "Date"),
    snippet: d.snippet,
    isRead: !d.labelIds.includes("UNREAD"),
    labels: d.labelIds,
    hasAttachments: d.labelIds.includes("HAS_ATTACHMENT"),
    body,
    attachments,
  };
}

// ---------- Calendar ----------

interface CalendarListEntry {
  id: string;
  summary: string;
  primary?: boolean;
}

interface CalendarEvent {
  id: string;
  summary?: string;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
  location?: string;
  organizer?: { displayName?: string; email?: string };
  attendees?: Array<{
    displayName?: string;
    email?: string;
    responseStatus?: string;
  }>;
  hangoutLink?: string;
  conferenceData?: {
    entryPoints?: Array<{ entryPointType: string; uri: string }>;
  };
}

function extractVideoLink(event: CalendarEvent): string | undefined {
  if (event.hangoutLink) return event.hangoutLink;
  return event.conferenceData?.entryPoints?.find(
    (e) => e.entryPointType === "video",
  )?.uri;
}

export interface CalendarEventItem {
  id: string;
  title: string;
  start: string;
  end: string;
  isAllDay: boolean;
  location?: string;
  organizer?: { name: string; email: string };
  attendees: Array<{ name: string; email: string; status: string }>;
  calendarName: string;
  videoLink?: string;
}

export async function listCalendarEvents(
  days: number = 30,
): Promise<CalendarEventItem[]> {
  const token = await getValidAccessToken();

  const calRes = await fetch(
    "https://www.googleapis.com/calendar/v3/users/me/calendarList",
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!calRes.ok)
    throw new Error(`Calendar list failed: ${await calRes.text()}`);
  const calData = (await calRes.json()) as { items: CalendarListEntry[] };
  const calendars = calData.items ?? [];

  const now = new Date();
  const timeMin = now.toISOString();
  const timeMax = new Date(now.getTime() + days * 86400 * 1000).toISOString();

  const allEvents: CalendarEventItem[] = [];

  await Promise.all(
    calendars.map(async (cal) => {
      const params = new URLSearchParams({
        timeMin,
        timeMax,
        singleEvents: "true",
        orderBy: "startTime",
        maxResults: "250",
      });
      const evRes = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal.id)}/events?${params}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!evRes.ok) return;
      const evData = (await evRes.json()) as { items: CalendarEvent[] };
      for (const ev of evData.items ?? []) {
        const isAllDay = Boolean(ev.start.date && !ev.start.dateTime);
        allEvents.push({
          id: ev.id,
          title: ev.summary ?? "(no title)",
          start: ev.start.dateTime ?? ev.start.date ?? "",
          end: ev.end.dateTime ?? ev.end.date ?? "",
          isAllDay,
          location: ev.location,
          organizer: ev.organizer?.email
            ? {
                name: ev.organizer.displayName ?? "",
                email: ev.organizer.email,
              }
            : undefined,
          attendees: (ev.attendees ?? []).map((a) => ({
            name: a.displayName ?? "",
            email: a.email ?? "",
            status: a.responseStatus ?? "unknown",
          })),
          calendarName: cal.summary,
          videoLink: extractVideoLink(ev),
        });
      }
    }),
  );

  return allEvents.sort((a, b) => a.start.localeCompare(b.start));
}
