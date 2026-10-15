CREATE TABLE "channels" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"type" varchar(50) NOT NULL,
	"name" varchar(255) NOT NULL,
	"phone_number" varchar(50),
	"meta_phone_number_id" varchar(100),
	"meta_access_token" text,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"channel_id" integer,
	"name" varchar(255) NOT NULL,
	"phone" varchar(50),
	"email" varchar(255),
	"avatar_url" text,
	"shopify_customer_id" varchar(100),
	"tags" text[] DEFAULT '{}'::text[],
	"is_opted_out" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"slug" varchar(100) NOT NULL,
	"plan" varchar(50) DEFAULT 'starter',
	"sla_response_minutes" integer DEFAULT 15,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"name" varchar(255) NOT NULL,
	"email" varchar(255) NOT NULL,
	"password_hash" varchar(255) NOT NULL,
	"role" varchar(50) DEFAULT 'AGENT',
	"avatar_url" text,
	"is_online" boolean DEFAULT false,
	"firebase_id_token" text NOT NULL,
	"firebase_gcm_token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_users_organization_email" UNIQUE("organization_id","email")
);
--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"ticket_number" varchar(50) NOT NULL,
	"customer_id" integer NOT NULL,
	"channel_id" integer,
	"assignee_id" integer,
	"status" varchar(50) DEFAULT 'OPEN',
	"priority" varchar(50) DEFAULT 'MEDIUM',
	"subject" text,
	"last_message_text" text,
	"last_message_at" timestamp with time zone DEFAULT now(),
	"unread_count" integer DEFAULT 0,
	"csat_rating" integer,
	"tags" text[] DEFAULT '{}'::text[],
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_tickets_organization_ticket_number" UNIQUE("organization_id","ticket_number")
);
--> statement-breakpoint
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
	"status" integer DEFAULT 0 NOT NULL,
	"error_code" integer,
	"meta_message_id" varchar(255),
	"replied_to_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_reactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"message_id" integer NOT NULL,
	"user_id" integer,
	"customer_id" integer,
	"emoji" varchar(50) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_receiver_id_customers_id_fk" FOREIGN KEY ("receiver_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_replied_to_id_messages_id_fk" FOREIGN KEY ("replied_to_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_reactions" ADD CONSTRAINT "message_reactions_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_reactions" ADD CONSTRAINT "message_reactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_reactions" ADD CONSTRAINT "message_reactions_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_channels_org_type" ON "channels" USING btree ("organization_id","type");--> statement-breakpoint
CREATE INDEX "idx_customers_org_phone" ON "customers" USING btree ("organization_id","phone");--> statement-breakpoint
CREATE INDEX "idx_customers_org_email" ON "customers" USING btree ("organization_id","email");--> statement-breakpoint
CREATE INDEX "idx_customers_org_channel" ON "customers" USING btree ("organization_id","channel_id");--> statement-breakpoint
CREATE INDEX "idx_customers_channel" ON "customers" USING btree ("channel_id");--> statement-breakpoint
CREATE INDEX "idx_organizations_slug" ON "organizations" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "idx_users_org_email" ON "users" USING btree ("organization_id","email");--> statement-breakpoint
CREATE INDEX "idx_tickets_org_status" ON "tickets" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "idx_tickets_org_assignee" ON "tickets" USING btree ("organization_id","assignee_id");--> statement-breakpoint
CREATE INDEX "idx_tickets_org_updated" ON "tickets" USING btree ("organization_id","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_messages_org_customer" ON "messages" USING btree ("organization_id","customer_id");--> statement-breakpoint
CREATE INDEX "idx_messages_sender_id" ON "messages" USING btree ("sender_id");--> statement-breakpoint
CREATE INDEX "idx_messages_receiver_id" ON "messages" USING btree ("receiver_id");--> statement-breakpoint
CREATE INDEX "idx_messages_status" ON "messages" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_messages_error_code" ON "messages" USING btree ("error_code");--> statement-breakpoint
CREATE INDEX "idx_messages_meta_message_id" ON "messages" USING btree ("meta_message_id");--> statement-breakpoint
CREATE INDEX "idx_messages_channel_id" ON "messages" USING btree ("channel_id");--> statement-breakpoint
CREATE INDEX "idx_messages_ticket_id" ON "messages" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX "idx_messages_replied_to_id" ON "messages" USING btree ("replied_to_id");--> statement-breakpoint
CREATE INDEX "idx_messages_created_at" ON "messages" USING btree ("organization_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_reactions_message" ON "message_reactions" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "idx_reactions_user" ON "message_reactions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_reactions_customer" ON "message_reactions" USING btree ("customer_id");