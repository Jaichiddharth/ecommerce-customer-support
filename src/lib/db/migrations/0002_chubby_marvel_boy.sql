CREATE TABLE "messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"customer_id" integer NOT NULL,
	"channel_id" integer,
	"ticket_id" integer,
	"sender_type" varchar(50) NOT NULL,
	"sender_id" integer,
	"receiver_id" integer,
	"text_content" text,
	"media_url" text,
	"media_type" varchar(50),
	"is_internal_note" boolean DEFAULT false,
	"is_read" boolean DEFAULT false,
	"meta_message_id" varchar(255),
	"replied_to_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_receiver_id_customers_id_fk" FOREIGN KEY ("receiver_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_replied_to_id_messages_id_fk" FOREIGN KEY ("replied_to_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_messages_org_customer" ON "messages" USING btree ("organization_id","customer_id");--> statement-breakpoint
CREATE INDEX "idx_messages_sender_id" ON "messages" USING btree ("sender_id");--> statement-breakpoint
CREATE INDEX "idx_messages_receiver_id" ON "messages" USING btree ("receiver_id");--> statement-breakpoint
CREATE INDEX "idx_messages_meta_message_id" ON "messages" USING btree ("meta_message_id");--> statement-breakpoint
CREATE INDEX "idx_messages_channel_id" ON "messages" USING btree ("channel_id");--> statement-breakpoint
CREATE INDEX "idx_messages_ticket_id" ON "messages" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX "idx_messages_replied_to_id" ON "messages" USING btree ("replied_to_id");--> statement-breakpoint
CREATE INDEX "idx_messages_created_at" ON "messages" USING btree ("organization_id","created_at" DESC NULLS LAST);