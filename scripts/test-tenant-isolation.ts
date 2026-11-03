/**
 * Automated Tenant Isolation Test Suite
 * 
 * Verifies that:
 * 1. organization_id is enforced across all tables and rows
 * 2. Organization A's data can NEVER be read by Organization B (queries, lists, searches)
 * 3. Organization B can NEVER update, mutate, or delete Organization A's data
 */

import { db } from "../src/lib/db";
import {
  organizations,
  users,
  channels,
  customers,
  tickets,
  messages,
  messageReactions,
  shopifyStores,
  invitations,
  TicketStatus,
  MessageStatus,
} from "../src/lib/db/schema";
import {
  customerRepository,
  conversationRepository,
  messageRepository,
  channelRepository,
  userRepository,
  invitationRepository,
  shopifyRepository,
  messageReactionRepository,
} from "../src/lib/db/repositories";
import { eq } from "drizzle-orm";

interface TestStats {
  passed: number;
  failed: number;
}

const stats: TestStats = { passed: 0, failed: 0 };

function assert(condition: boolean, message: string) {
  if (condition) {
    stats.passed++;
    console.log(`  \x1b[32m✔ PASS\x1b[0m: ${message}`);
  } else {
    stats.failed++;
    console.error(`  \x1b[31m✖ FAIL\x1b[0m: ${message}`);
  }
}

async function runTenantIsolationTests() {
  console.log("\n========================================================");
  console.log("       AUTOMATED TENANT ISOLATION TEST SUITE            ");
  console.log("========================================================\n");

  const runId = Date.now();
  let orgA: any = null;
  let orgB: any = null;

  try {
    // -----------------------------------------------------------------
    // SETUP: Provision Two Completely Independent Organizations
    // -----------------------------------------------------------------
    console.log("\x1b[36m[Setup]\x1b[0m Provisioning Tenant Alpha and Tenant Beta...");

    [orgA] = await db
      .insert(organizations)
      .values({
        name: `Tenant Alpha ${runId}`,
        slug: `tenant-alpha-${runId}`,
        plan: "pro",
      })
      .returning();

    [orgB] = await db
      .insert(organizations)
      .values({
        name: `Tenant Beta ${runId}`,
        slug: `tenant-beta-${runId}`,
        plan: "growth",
      })
      .returning();

    // 1. Seed Tenant Alpha resources
    const userA = await userRepository.create({
      organizationId: orgA.id,
      name: "Alice Owner",
      email: `alice-${runId}@alpha.test`,
      role: "OWNER",
      firebaseIdToken: `firebase_uid_alice_${runId}`,
    });

    const [channelA] = await db
      .insert(channels)
      .values({
        organizationId: orgA.id,
        type: "whatsapp",
        name: "Alpha WhatsApp",
        metaPhoneNumberId: `phone_id_alpha_${runId}`,
        phoneNumber: `15551110001`,
        wabaId: `waba_alpha_${runId}`,
      })
      .returning();

    const customerA = await customerRepository.createCustomer(orgA.id, {
      name: "Alpha Customer One",
      phone: `15551110002`,
      email: `customer1@alpha.test`,
      channelId: channelA.id,
      tags: ["vip", "alpha"],
    });

    if (!customerA) throw new Error("Failed to create customerA");

    const ticketA = await conversationRepository.ensureForCustomer(orgA.id, customerA.id, channelA.id);

    const messageA = await messageRepository.createMessage({
      organizationId: orgA.id,
      customerId: customerA.id,
      channelId: channelA.id,
      ticketId: ticketA.id,
      senderType: "customer",
      textContent: "Secret Alpha trade message content",
      metaMessageId: `wamid.alpha.${runId}`,
      status: MessageStatus.SENT,
    });

    if (!messageA) throw new Error("Failed to create messageA");

    const reactionA = await messageReactionRepository.upsertReaction({
      organizationId: orgA.id,
      messageId: messageA.id,
      userId: userA.id,
      emoji: "🔥",
    });

    const storeA = await shopifyRepository.upsertStore({
      organizationId: orgA.id,
      shopDomain: `alpha-store-${runId}.myshopify.com`,
      name: "Alpha Boutique",
      scopes: "read_products,read_orders",
      status: "connected",
      connectedById: userA.id,
    });

    const inviteA = await invitationRepository.create({
      organizationId: orgA.id,
      email: `invite-alpha-${runId}@test.com`,
      name: "New Alpha Member",
      role: "AGENT",
      token: `token-alpha-${runId}`,
      expiresAt: new Date(Date.now() + 86400000),
    });

    // 2. Seed Tenant Beta resources
    const userB = await userRepository.create({
      organizationId: orgB.id,
      name: "Bob Owner",
      email: `bob-${runId}@beta.test`,
      role: "OWNER",
      firebaseIdToken: `firebase_uid_bob_${runId}`,
    });

    const [channelB] = await db
      .insert(channels)
      .values({
        organizationId: orgB.id,
        type: "whatsapp",
        name: "Beta WhatsApp",
        metaPhoneNumberId: `phone_id_beta_${runId}`,
        phoneNumber: `15552220001`,
        wabaId: `waba_beta_${runId}`,
      })
      .returning();

    const customerB = await customerRepository.createCustomer(orgB.id, {
      name: "Beta Customer One",
      phone: `15552220002`,
      email: `customer1@beta.test`,
      channelId: channelB.id,
    });

    console.log("\x1b[32m[Setup Complete]\x1b[0m Tenant Alpha (ID: " + orgA.id + ") & Tenant Beta (ID: " + orgB.id + ")\n");

    // -----------------------------------------------------------------
    // TEST SUITE 1: CUSTOMER ISOLATION
    // -----------------------------------------------------------------
    console.log("\x1b[35m[Suite 1] Customer Isolation Tests\x1b[0m");

    // Can Org B fetch Org A's customer by ID?
    const leakedCustomerById = await customerRepository.findById(customerA.id, orgB.id);
    assert(leakedCustomerById === null, "Org B cannot read Org A customer by ID");

    // Can Org B lookup Org A customer by phone?
    const leakedCustomerByPhone = await customerRepository.findByPhone(orgB.id, customerA.phone!);
    assert(leakedCustomerByPhone === null, "Org B cannot find Org A customer by phone number");

    // Can Org B lookup Org A customer by email?
    const leakedCustomerByEmail = await customerRepository.findByEmail(orgB.id, customerA.email!);
    assert(leakedCustomerByEmail === null, "Org B cannot find Org A customer by email");

    // Does Org A customer appear in Org B customer list?
    const orgBCustomers = await customerRepository.listByOrg(orgB.id);
    const foundAInBList = orgBCustomers.some((c) => c.id === customerA.id);
    assert(!foundAInBList, "Org B customer list does not contain Org A customer");

    // Can Org B search for Org A customer?
    const searchResults = await customerRepository.searchVisible(orgB.id, "Alpha");
    assert(searchResults.length === 0, "Org B search does not leak Org A customer");

    // Can Org B update/hijack Org A customer?
    const maliciousCustomerUpdate = await customerRepository.updateCustomer(customerA.id, orgB.id, {
      name: "Compromised Name",
    });
    assert(maliciousCustomerUpdate === null, "Org B cannot update Org A customer (rejected)");

    const pristineCustomerA = await customerRepository.findById(customerA.id, orgA.id);
    assert(pristineCustomerA?.name === "Alpha Customer One", "Org A customer data remains unaltered after attack");

    // -----------------------------------------------------------------
    // TEST SUITE 2: CONVERSATION & TICKET ISOLATION
    // -----------------------------------------------------------------
    console.log("\n\x1b[35m[Suite 2] Ticket & Conversation Isolation Tests\x1b[0m");

    // Can Org B read Org A ticket by ID?
    const leakedTicket = await conversationRepository.findById(ticketA.id, orgB.id);
    assert(leakedTicket === null, "Org B cannot read Org A ticket/conversation by ID");

    // Does Org A conversation appear in Org B inbox list?
    const orgBInbox = await conversationRepository.listForInbox(orgB.id);
    const foundTicketInBInbox = orgBInbox.some((t) => t.id === ticketA.id || t.customer.id === customerA.id);
    assert(!foundTicketInBInbox, "Org B inbox list does not contain Org A conversation");

    // Can Org B update Org A ticket?
    const maliciousTicketUpdate = await conversationRepository.update(ticketA.id, orgB.id, {
      status: TicketStatus.CLOSED,
    });
    assert(maliciousTicketUpdate === null, "Org B cannot modify Org A ticket");

    const pristineTicketA = await conversationRepository.findById(ticketA.id, orgA.id);
    assert(pristineTicketA?.status === TicketStatus.OPEN, "Org A ticket status remains unchanged");

    // -----------------------------------------------------------------
    // TEST SUITE 3: MESSAGE ISOLATION
    // -----------------------------------------------------------------
    console.log("\n\x1b[35m[Suite 3] Message Thread Isolation Tests\x1b[0m");

    // Can Org B read Org A message by primary key?
    const leakedMessageById = await messageRepository.findById(messageA.id, orgB.id);
    assert(leakedMessageById === null, "Org B cannot read Org A message by ID");

    // Can Org B read Org A message by Meta message ID (wamid)?
    const leakedMessageByWamid = await messageRepository.findByMetaMessageId(messageA.metaMessageId!, orgB.id);
    assert(leakedMessageByWamid === null, "Org B cannot read Org A message by Meta wamid");

    // Can Org B list messages for Org A customer?
    const leakedMessageList = await messageRepository.listByCustomer(customerA.id, orgB.id);
    assert(leakedMessageList.length === 0, "Org B cannot read messages belonging to Org A customer");

    // Can Org B page messages for Org A customer?
    const leakedPaged = await messageRepository.listPageByCustomer(customerA.id, orgB.id, { limit: 20 });
    assert(leakedPaged.messages.length === 0, "Org B message pagination returns zero messages for Org A customer");

    // -----------------------------------------------------------------
    // TEST SUITE 4: MESSAGE REACTIONS ISOLATION
    // -----------------------------------------------------------------
    console.log("\n\x1b[35m[Suite 4] Message Reaction Isolation Tests\x1b[0m");

    // Can Org B list reactions for Org A message?
    const leakedReactionsSingle = await messageReactionRepository.listByMessageId(messageA.id, orgB.id);
    assert(leakedReactionsSingle.length === 0, "Org B cannot read reactions for Org A message");

    const leakedReactionsBatch = await messageReactionRepository.listByMessageIds([messageA.id], orgB.id);
    assert(leakedReactionsBatch.length === 0, "Org B cannot batch-query reactions for Org A message");

    // Can Org B delete Org A reaction?
    const deletedCrossOrg = await messageReactionRepository.deleteReaction({
      organizationId: orgB.id,
      messageId: messageA.id,
      userId: userA.id,
    });
    const reactionsOrgA = await messageReactionRepository.listByMessageId(messageA.id, orgA.id);
    assert(reactionsOrgA.length === 1 && reactionsOrgA[0].emoji === "🔥", "Org A reaction remains intact after Org B deletion attempt");

    // -----------------------------------------------------------------
    // TEST SUITE 5: CHANNEL ISOLATION
    // -----------------------------------------------------------------
    console.log("\n\x1b[35m[Suite 5] Channel Isolation Tests\x1b[0m");

    // Can Org B fetch Org A channel by ID?
    const leakedChannel = await channelRepository.findById(channelA.id, orgB.id);
    assert(leakedChannel === null, "Org B cannot read Org A channel by ID");

    // Can Org B fetch Org A channel by phone number ID?
    const leakedChannelByPhoneId = await channelRepository.findByPhoneId(orgB.id, channelA.metaPhoneNumberId!);
    assert(leakedChannelByPhoneId === null, "Org B cannot read Org A channel by phone ID");

    // -----------------------------------------------------------------
    // TEST SUITE 6: SHOPIFY INTEGRATION & MULTI-STORE ISOLATION
    // -----------------------------------------------------------------
    console.log("\n\x1b[35m[Suite 6] Shopify Store Isolation Tests\x1b[0m");

    // Can Org B read Org A store by domain?
    const leakedStoreByDomain = await shopifyRepository.findStoreByDomain(orgB.id, storeA.shopDomain);
    assert(leakedStoreByDomain === null, "Org B cannot find Org A Shopify store by domain");

    // Can Org B get Org A active store?
    const leakedActiveStore = await shopifyRepository.findActiveStore(orgB.id, storeA.id);
    assert(leakedActiveStore === null, "Org B cannot access Org A active Shopify store");

    // Does Org A store appear in Org B store list?
    const orgBStores = await shopifyRepository.findActiveStores(orgB.id);
    assert(orgBStores.length === 0, "Org B store list does not leak Org A stores");

    // Can Org B modify Org A store connection?
    const maliciousStoreUpdate = await shopifyRepository.updateStore(storeA.id, orgB.id, {
      status: "disconnected",
    });
    assert(maliciousStoreUpdate === null, "Org B cannot disconnect or modify Org A store");

    const pristineStoreA = await shopifyRepository.findStoreByDomain(orgA.id, storeA.shopDomain);
    assert(pristineStoreA?.status === "connected", "Org A store remains connected and unaffected");

    // -----------------------------------------------------------------
    // TEST SUITE 7: TEAM MEMBERS & INVITATIONS ISOLATION
    // -----------------------------------------------------------------
    console.log("\n\x1b[35m[Suite 7] Team & Invitations Isolation Tests\x1b[0m");

    // Can Org B find Org A user scoped to Org B?
    const leakedUser = await userRepository.findById(userA.id, orgB.id);
    assert(leakedUser === null, "Org B cannot access Org A user record");

    // Can Org B modify Org A user?
    const maliciousUserUpdate = await userRepository.updateTeamMember(userA.id, orgB.id, {
      role: "ADMIN",
    });
    assert(maliciousUserUpdate === null, "Org B cannot edit Org A team member");

    // Can Org B delete Org A user?
    const maliciousUserDelete = await userRepository.deleteTeamMember(userA.id, orgB.id);
    assert(!maliciousUserDelete, "Org B cannot delete Org A team member");

    // Can Org B see Org A invitations?
    const orgBInvitations = await invitationRepository.listByOrg(orgB.id);
    assert(orgBInvitations.length === 0, "Org B invitation list is empty and does not leak Org A invitation");

    // Can Org B lookup Org A pending invite by email?
    const leakedInvite = await invitationRepository.findPendingByOrgAndEmail(orgB.id, inviteA.email);
    assert(leakedInvite === null, "Org B cannot find Org A invitation by email");

    // Can Org B revoke Org A invitation?
    const maliciousRevoke = await invitationRepository.revoke(inviteA.id, orgB.id);
    assert(!maliciousRevoke, "Org B cannot revoke Org A invitation");

    // Can Org B delete Org A invitation?
    const maliciousInviteDelete = await invitationRepository.delete(inviteA.id, orgB.id);
    assert(!maliciousInviteDelete, "Org B cannot delete Org A invitation");

    console.log("\n--------------------------------------------------------");
    console.log(`Results: \x1b[32m${stats.passed} Passed\x1b[0m, \x1b[31m${stats.failed} Failed\x1b[0m out of ${stats.passed + stats.failed} tests`);
    console.log("--------------------------------------------------------\n");

  } finally {
    // -----------------------------------------------------------------
    // TEARDOWN: Clean up test organizations (cascade deletes all children)
    // -----------------------------------------------------------------
    console.log("\x1b[36m[Teardown]\x1b[0m Cleaning up test organizations...");
    if (orgA?.id) {
      await db.delete(organizations).where(eq(organizations.id, orgA.id));
    }
    if (orgB?.id) {
      await db.delete(organizations).where(eq(organizations.id, orgB.id));
    }
    console.log("\x1b[32m[Teardown Complete]\x1b[0m Test tenants wiped clean.\n");
  }

  if (stats.failed > 0) {
    process.exit(1);
  }
}

runTenantIsolationTests()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error("Test execution fatal error:", err);
    process.exit(1);
  });
