import { customerRepository, whatsappFlowRepository, type SubmissionSortKey } from "../../db/repositories";
import { toListResult, type ListQuery } from "@/lib/api/list-query";
import { WaSubmissionStatus, type WhatsAppFlowSubmissionRow } from "../../db/schema";
import { automationEngine } from "@/lib/automation/engine";
import { mapLimit } from "@/lib/concurrency";
import { toAppError } from "@/lib/errors";
import { createLogger } from "@/lib/logger";
import { formatFlowResponse, summarizeFlowAnswers, type FlowAnswer } from "@/lib/whatsapp-flows/flow-response-format";

const log = createLogger("WhatsAppFlowSubmission");

/** The Flow-completion part of an inbound WhatsApp message, if it is one. */
export function parseFlowReply(msg: any): { response: Record<string, unknown>; flowToken: string | null; contextWamid: string | null } | null {
  const reply = msg?.type === "interactive" && msg.interactive?.type === "nfm_reply" ? msg.interactive.nfm_reply : null;
  if (!reply) return null;
  let parsed: Record<string, unknown> = {};
  try {
    const raw = typeof reply.response_json === "string" ? JSON.parse(reply.response_json) : reply.response_json;
    if (raw && typeof raw === "object" && !Array.isArray(raw)) parsed = raw as Record<string, unknown>;
  } catch {
    parsed = { _raw: String(reply.response_json ?? "") };
  }
  // flow_token is ours, not the customer's answer
  const { flow_token, ...response } = parsed;
  return {
    response,
    flowToken: typeof flow_token === "string" && flow_token && flow_token !== "unused" ? flow_token : null,
    contextWamid: typeof msg.context?.id === "string" ? msg.context.id : null,
  };
}

/** One-line inbox summary of a Flow response, without its Flow's labels (see `describeReply`). */
export function summarizeFlowReply(response: Record<string, unknown>): string {
  return summarizeFlowAnswers(formatFlowResponse(response));
}

export class WhatsAppFlowSubmissionService {
  /**
   * How an inbound Flow response reads in the inbox: answers labelled with the questions of the Flow
   * version that was sent (option ids → titles), plus a one-line summary. Display only: linking the
   * response to its send happens in `record`. Returns null when `msg` isn't a Flow response.
   */
  async describeReply(organizationId: number, msg: any): Promise<{
    flowId: number | null;
    flowName: string | null;
    answers: FlowAnswer[];
    summary: string;
  } | null> {
    const reply = parseFlowReply(msg);
    if (!reply) return null;
    const execution = await whatsappFlowRepository
      .findExecutionForReply(organizationId, { flowToken: reply.flowToken, contextWamid: reply.contextWamid })
      .catch(() => null);
    const [version, flow] = execution
      ? await Promise.all([
          whatsappFlowRepository.findVersion(execution.flowVersionId, organizationId).catch(() => null),
          whatsappFlowRepository.findFlow(execution.flowId, organizationId).catch(() => null),
        ])
      : [null, null];
    const answers = formatFlowResponse(reply.response, version?.definition);
    const flowName = flow?.name ?? null;
    return { flowId: flow?.id ?? null, flowName, answers, summary: summarizeFlowAnswers(answers, flowName) };
  }

  /**
   * Stores a Flow response (synchronously, inside the webhook request) and returns the stored row,
   * or null when this wamid was already stored (Meta retry). The automation is resumed separately
   * by `process`, which may run after the webhook response has been sent.
   */
  async record(params: {
    organizationId: number;
    channelId: number;
    customerId: number;
    wamid: string;
    timestamp: Date;
    msg: any;
  }): Promise<WhatsAppFlowSubmissionRow | null> {
    const reply = parseFlowReply(params.msg);
    if (!reply) return null;

    const execution = await whatsappFlowRepository.findExecutionForReply(params.organizationId, {
      flowToken: reply.flowToken,
      contextWamid: reply.contextWamid,
    });

    // The execution must be this tenant's (query is org-scoped) and this customer's (same contact or same phone)
    let matched = execution;
    if (execution && execution.customerId !== params.customerId) {
      const [sender, recipient] = await Promise.all([
        customerRepository.findById(params.customerId, params.organizationId),
        customerRepository.findById(execution.customerId, params.organizationId),
      ]);
      if (!sender?.phone || sender.phone !== recipient?.phone) {
        log.warn("Flow response token belongs to another contact — not associated", {
          executionId: execution.id,
          customerId: params.customerId,
        });
        matched = null;
      }
    }

    const row = await whatsappFlowRepository.insertSubmission({
      organizationId: params.organizationId,
      executionId: matched?.id ?? null,
      flowId: matched?.flowId ?? null,
      flowVersionId: matched?.flowVersionId ?? null,
      customerId: params.customerId,
      channelId: params.channelId,
      metaMessageId: params.wamid,
      flowToken: reply.flowToken,
      response: reply.response,
      processingStatus: matched ? WaSubmissionStatus.RECEIVED : WaSubmissionStatus.UNMATCHED,
      submittedAt: params.timestamp,
    });
    if (!row) {
      log.debug("Duplicate Flow response ignored", { wamid: params.wamid });
      return null;
    }
    log.info("Flow response stored", { submissionId: row.id, executionId: matched?.id ?? null, matched: !!matched });
    return row;
  }

  /** Completes the execution and resumes its automation. Idempotent: the execution completes once. */
  async process(submission: WhatsAppFlowSubmissionRow) {
    if (!submission.executionId || submission.processingStatus !== WaSubmissionStatus.RECEIVED) return;
    try {
      const completed = await whatsappFlowRepository.completeExecution(submission.executionId);
      const execution = completed ?? (await whatsappFlowRepository.findExecution(submission.executionId, submission.organizationId));
      const runId = completed
        ? await automationEngine.resumeOnFlowSubmission(submission.executionId, execution?.automationRunId ?? null, submission.response)
        : null;
      await whatsappFlowRepository.updateSubmission(submission.id, {
        processingStatus: WaSubmissionStatus.PROCESSED,
        automationRunId: runId ?? execution?.automationRunId ?? null,
      });
    } catch (err) {
      const appErr = toAppError(err);
      await whatsappFlowRepository.updateSubmission(submission.id, { processingStatus: WaSubmissionStatus.FAILED, lastError: appErr.message });
      log.error("Flow response processing failed", { err: appErr, submissionId: submission.id });
    }
  }

  /** Recovery for submissions stored but never processed (process stopped mid-way). Called by the sweep. */
  async processStale(olderThan = new Date(Date.now() - 60_000)) {
    const stale = await whatsappFlowRepository.listStaleReceivedSubmissions(olderThan);
    await mapLimit(stale, 4, (s) => this.process(s));
    return stale.length;
  }

  /** Submissions listing: filtered (Flow, status, submitted date), sorted, counted and paginated in the database. */
  async list(organizationId: number, params: ListQuery<SubmissionSortKey> & { flowId?: number; status?: string }) {
    const { rows, total } = await whatsappFlowRepository.listSubmissions(organizationId, {
      flowId: params.flowId,
      status: params.status,
      fromDate: params.fromDate,
      toDate: params.toDate,
      sortBy: params.sortBy,
      sortOrder: params.sortOrder,
      limit: params.limit,
      offset: params.offset,
    });
    // Readable answers (question labels, option titles) from the version that was sent; the definition itself stays server-side
    const withAnswers = rows.map(({ flowDefinition, ...row }) => ({
      ...row,
      answers: formatFlowResponse(row.response ?? {}, flowDefinition),
    }));
    return toListResult(withAnswers, total, params);
  }
}

export const whatsappFlowSubmissionService = new WhatsAppFlowSubmissionService();
