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
ALTER TABLE "channels" ADD CONSTRAINT "channels_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_channels_org_type" ON "channels" USING btree ("organization_id","type");--> statement-breakpoint
CREATE INDEX "idx_customers_org_phone" ON "customers" USING btree ("organization_id","phone");--> statement-breakpoint
CREATE INDEX "idx_customers_org_email" ON "customers" USING btree ("organization_id","email");--> statement-breakpoint
CREATE INDEX "idx_organizations_slug" ON "organizations" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "idx_users_org_email" ON "users" USING btree ("organization_id","email");--> statement-breakpoint
CREATE INDEX "idx_tickets_org_status" ON "tickets" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "idx_tickets_org_assignee" ON "tickets" USING btree ("organization_id","assignee_id");--> statement-breakpoint
CREATE INDEX "idx_tickets_org_updated" ON "tickets" USING btree ("organization_id","updated_at" DESC NULLS LAST);