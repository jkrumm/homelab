import { Elysia, t } from "elysia";
import {
  listEmails,
  getEmail,
  listCalendarEvents,
} from "../clients/google.js";

const AddressSchema = t.Object({
  name: t.String({ description: "Display name" }),
  email: t.String({ description: "Email address" }),
});

const AttachmentSchema = t.Object({
  filename: t.String(),
  mimeType: t.String(),
  size: t.Number({ description: "Size in bytes" }),
});

const EmailListItemSchema = t.Object({
  id: t.String({ description: "Gmail message ID" }),
  subject: t.String(),
  from: AddressSchema,
  to: t.Array(AddressSchema),
  date: t.String({ description: "RFC 2822 date string" }),
  snippet: t.String({ description: "200-char preview" }),
  isRead: t.Boolean(),
  labels: t.Array(t.String(), { description: "Gmail label IDs" }),
  hasAttachments: t.Boolean(),
});

const EmailDetailSchema = t.Object({
  id: t.String(),
  subject: t.String(),
  from: AddressSchema,
  to: t.Array(AddressSchema),
  date: t.String(),
  snippet: t.String(),
  isRead: t.Boolean(),
  labels: t.Array(t.String()),
  hasAttachments: t.Boolean(),
  body: t.String({
    description: "Decoded plaintext body (HTML stripped as fallback)",
  }),
  attachments: t.Array(AttachmentSchema),
});

const AttendeeSchema = t.Object({
  name: t.String(),
  email: t.String(),
  status: t.String({
    description: "accepted | declined | tentative | needsAction | unknown",
  }),
});

const CalendarEventSchema = t.Object({
  id: t.String(),
  title: t.String(),
  start: t.String({ description: "ISO timestamp or YYYY-MM-DD for all-day" }),
  end: t.String({ description: "ISO timestamp or YYYY-MM-DD for all-day" }),
  isAllDay: t.Boolean(),
  location: t.Optional(t.String()),
  organizer: t.Optional(
    t.Object({ name: t.String(), email: t.String() }),
  ),
  attendees: t.Array(AttendeeSchema),
  calendarName: t.String({ description: "Source calendar name" }),
  videoLink: t.Optional(
    t.String({ description: "Google Meet or conference link" }),
  ),
});

export const gmailRoutes = new Elysia({ prefix: "/gmail" })
  .get(
    "/emails",
    async ({ query, set }) => {
      try {
        return await listEmails({
          days: query.days ? Number(query.days) : undefined,
          maxResults: query.maxResults ? Number(query.maxResults) : undefined,
          query: query.query,
        });
      } catch (error) {
        set.status = 503;
        return error instanceof Error ? error.message : "Google API error";
      }
    },
    {
      query: t.Object({
        days: t.Optional(
          t.String({ description: "Days back to search (default: 7)" }),
        ),
        maxResults: t.Optional(
          t.String({ description: "Max emails returned (default: 50)" }),
        ),
        query: t.Optional(
          t.String({ description: "Free-text Gmail search string" }),
        ),
      }),
      response: { 200: t.Array(EmailListItemSchema), 503: t.String() },
      detail: {
        tags: ["Gmail"],
        summary: "List emails",
        description:
          "Returns inbox emails excluding spam, promotions, and social categories. Sorted by date descending. Supports free-text Gmail search syntax.",
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .get(
    "/emails/:id",
    async ({ params: { id }, set }) => {
      try {
        return await getEmail(id);
      } catch (error) {
        set.status = 404;
        return error instanceof Error ? error.message : "Email not found";
      }
    },
    {
      params: t.Object({ id: t.String({ description: "Gmail message ID" }) }),
      response: { 200: EmailDetailSchema, 404: t.String() },
      detail: {
        tags: ["Gmail"],
        summary: "Get email detail",
        description:
          "Returns full email with decoded body (plaintext preferred, HTML stripped as fallback) and attachment metadata.",
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .get(
    "/calendar",
    async ({ query, set }) => {
      try {
        return await listCalendarEvents(
          query.days ? Number(query.days) : undefined,
        );
      } catch (error) {
        set.status = 503;
        return error instanceof Error ? error.message : "Google API error";
      }
    },
    {
      query: t.Object({
        days: t.Optional(
          t.String({
            description: "Days window from today (default: 30)",
          }),
        ),
      }),
      response: { 200: t.Array(CalendarEventSchema), 503: t.String() },
      detail: {
        tags: ["Google Calendar"],
        summary: "List upcoming events",
        description:
          "Returns events from all personal Google calendars merged into a single list, sorted by start time ascending.",
        security: [{ BearerAuth: [] }],
      },
    },
  );
