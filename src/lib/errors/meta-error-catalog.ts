import type { ErrorCode } from "./codes";

/**
 * Meta Graph / WhatsApp Cloud API error codes.
 *
 * - title / userMessage → shown in the UI (toast heading, failed-message badge, error panels)
 * - description / solution → written to the server logs for whoever is debugging
 * - code → our internal error code (decides HTTP status + error category)
 * - retryable → whether trying the same request again can succeed
 *
 * Reference: https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes
 */
export interface MetaErrorEntry {
  title: string;
  userMessage: string;
  description: string;
  solution: string;
  code: ErrorCode;
  retryable?: boolean;
}

export const META_ERROR_CATALOG: Record<number, MetaErrorEntry> = {
  /* ---------------- Authorization & permissions ---------------- */
  0: {
    title: "Authentication Failed",
    userMessage: "We couldn't verify your WhatsApp connection. Please reconnect your WhatsApp Business account to keep sending messages.",
    description: "The access token may have expired, been invalidated, or the account settings may prevent the app from accessing WhatsApp data.",
    solution: "Reconnect the WhatsApp Business Account or generate a new valid access token.",
    code: "WHATSAPP_REAUTH_REQUIRED",
  },
  3: {
    title: "Permission or Capability Issue",
    userMessage: "Your WhatsApp account is missing a required permission. Please reconnect your account to restore access.",
    description: "The access token does not have the required permissions or capabilities.",
    solution: "Check the access token permissions and make sure the required WhatsApp permissions have been granted.",
    code: "META_PERMISSION_DENIED",
  },
  10: {
    title: "Permission Not Granted",
    userMessage: "A required WhatsApp permission is missing. Please reconnect your account to grant access.",
    description: "The required permission may not have been granted or may have been removed.",
    solution: "Check the access token permissions and make sure your WhatsApp Business Account is eligible for this API operation.",
    code: "META_PERMISSION_DENIED",
  },
  190: {
    title: "Access Token Expired",
    userMessage: "Your WhatsApp connection has expired. Please reconnect your account to keep sending messages.",
    description: "The access token used for the request has expired or is no longer valid.",
    solution: "Reconnect the WhatsApp Business Account or generate a new valid access token.",
    code: "WHATSAPP_REAUTH_REQUIRED",
  },
  200: {
    title: "Access Token Missing",
    userMessage: "We couldn't find a valid WhatsApp connection. Please reconnect your account.",
    description: "The API request was made without a valid access token.",
    solution: "Include a valid access token with the API request.",
    code: "WHATSAPP_REAUTH_REQUIRED",
  },
  131005: {
    title: "Permission Not Granted",
    userMessage: "A required WhatsApp permission is missing. Please reconnect your account to restore access.",
    description: "The required permission has not been granted or has been removed.",
    solution: "Check the access token permissions and make sure the required WhatsApp permissions are available.",
    code: "META_PERMISSION_DENIED",
  },

  /* ---------------- Service availability ---------------- */
  1: {
    title: "Invalid Request or Server Error",
    userMessage: "We couldn't process that request. Please try again, and reach out to support if it keeps happening.",
    description: "The request may be invalid, or WhatsApp may have encountered a server-side problem.",
    solution: "Check the request format and parameters. If the request is correct, check the WhatsApp service status and try again.",
    code: "META_UNAVAILABLE",
    retryable: true,
  },
  2: {
    title: "Temporary Service Issue",
    userMessage: "WhatsApp is temporarily unavailable. Please try again in a few minutes.",
    description: "The WhatsApp service may be experiencing downtime or high traffic.",
    solution: "Please try again later and check the WhatsApp Business Platform service status.",
    code: "META_UNAVAILABLE",
    retryable: true,
  },
  131000: {
    title: "Unknown Sending Error",
    userMessage: "This message couldn't be sent due to an unexpected error. Please try again, or contact support if it continues.",
    description: "The message failed because of an unknown WhatsApp error.",
    solution: "Try sending the message again. If the problem continues, contact Meta support with the error details.",
    code: "MESSAGE_SEND_FAILED",
    retryable: true,
  },
  131016: {
    title: "Service Temporarily Unavailable",
    userMessage: "WhatsApp is temporarily unavailable. Please try again shortly.",
    description: "The WhatsApp service is temporarily unavailable.",
    solution: "Please try again later and check the WhatsApp Business Platform service status.",
    code: "META_UNAVAILABLE",
    retryable: true,
  },
  131057: {
    title: "WhatsApp Business Account Maintenance",
    userMessage: "Your WhatsApp account is undergoing maintenance. Please try again shortly.",
    description: "The WhatsApp Business Account is currently in maintenance mode.",
    solution: "Wait until the maintenance period is complete and try again.",
    code: "META_UNAVAILABLE",
    retryable: true,
  },
  133004: {
    title: "WhatsApp Server Temporarily Unavailable",
    userMessage: "WhatsApp's servers are temporarily unavailable. Please try again shortly.",
    description: "The WhatsApp server is currently unavailable.",
    solution: "Check the WhatsApp Business Platform status and try again later.",
    code: "META_UNAVAILABLE",
    retryable: true,
  },
  2494100: {
    title: "Account Maintenance Mode",
    userMessage: "Your WhatsApp phone number is temporarily unavailable due to maintenance. Please try again shortly.",
    description: "The business phone number is currently in maintenance mode.",
    solution: "Wait a few minutes and try the operation again.",
    code: "META_UNAVAILABLE",
    retryable: true,
  },

  /* ---------------- Rate limits ---------------- */
  4: {
    title: "Application Rate Limit Reached",
    userMessage: "You're sending too many requests at once. Please wait a bit and try again.",
    description: "Your application has reached its API call rate limit.",
    solution: "Reduce the frequency of API requests and try again after the rate limit has cleared.",
    code: "META_RATE_LIMITED",
    retryable: true,
  },
  80007: {
    title: "WhatsApp Account Rate Limit Reached",
    userMessage: "Your WhatsApp account has hit its sending limit. Please wait a while before trying again.",
    description: "The WhatsApp Business Account has exceeded its allowed API request rate.",
    solution: "Reduce the frequency or volume of API requests and try again later.",
    code: "META_RATE_LIMITED",
    retryable: true,
  },
  130429: {
    title: "Message Throughput Limit Reached",
    userMessage: "You're sending messages faster than WhatsApp currently allows. Please slow down and try again shortly.",
    description: "The Cloud API message throughput limit has been reached.",
    solution: "Reduce the message sending rate and try again after the throughput limit has cleared.",
    code: "META_RATE_LIMITED",
    retryable: true,
  },
  131056: {
    title: "Too Many Messages to Same Customer",
    userMessage: "Too many messages have been sent to this customer recently. Please wait before sending another.",
    description: "The sender phone number exceeded the allowed message frequency for the same recipient.",
    solution: "Wait before sending another message to this customer.",
    code: "META_RATE_LIMITED",
    retryable: true,
  },

  /* ---------------- Account, number & registration ---------------- */
  33: {
    title: "Phone Number Deleted",
    userMessage: "This WhatsApp number is no longer available. Please check your number or reconnect your account.",
    description: "The business phone number associated with the request has been deleted.",
    solution: "Verify the phone number ID and make sure the number is still registered with the WhatsApp Business Account.",
    code: "WHATSAPP_CHANNEL_MISCONFIGURED",
  },
  368: {
    title: "WhatsApp Account Restricted",
    userMessage: "Your WhatsApp account has been restricted by Meta. Please review your account status in WhatsApp Manager.",
    description: "The account has been restricted or disabled because of a platform policy violation.",
    solution: "Review the WhatsApp Business Messaging Policy and resolve the policy issue affecting the account.",
    code: "WHATSAPP_CHANNEL_MISCONFIGURED",
  },
  131031: {
    title: "WhatsApp Account Restricted or Verification Failed",
    userMessage: "Your WhatsApp account couldn't be verified. Please check your account status and try again.",
    description: "The account may be restricted or information in the request could not be verified against the WhatsApp Business Account.",
    solution: "Check the WhatsApp Business Account status and verify that the account information and security credentials are correct.",
    code: "WHATSAPP_CHANNEL_MISCONFIGURED",
  },
  131037: {
    title: "Display Name Not Approved",
    userMessage: "Your business display name hasn't been approved yet. Please update it and wait for Meta's review.",
    description: "The business phone number does not have an approved display name.",
    solution: "Submit or update the business display name and wait for Meta approval.",
    code: "WHATSAPP_CHANNEL_MISCONFIGURED",
  },
  131042: {
    title: "Payment Configuration Error",
    userMessage: "There's an issue with your WhatsApp billing setup. Please check your payment details in WhatsApp Manager.",
    description: "The payment account may be missing, inactive, over its credit limit, or incorrectly configured.",
    solution: "Check the payment account, credit line, currency, timezone, and WhatsApp Business Account billing configuration.",
    code: "WHATSAPP_CHANNEL_MISCONFIGURED",
  },
  131045: {
    title: "Phone Number Registration Error",
    userMessage: "There's a problem with your phone number's registration. Please check its status before sending messages.",
    description: "The message failed because of a phone number registration problem.",
    solution: "Register the phone number correctly with WhatsApp Business Platform before sending messages.",
    code: "WHATSAPP_CHANNEL_MISCONFIGURED",
  },
  133000: {
    title: "Previous Deregistration Failed",
    userMessage: "A previous attempt to remove this number didn't complete. Please try removing it again.",
    description: "A previous deregistration attempt failed.",
    solution: "Deregister the phone number again before attempting to register it.",
    code: "WHATSAPP_CHANNEL_MISCONFIGURED",
  },
  133005: {
    title: "Incorrect Two-Step Verification PIN",
    userMessage: "The verification PIN you entered is incorrect. Please check it and try again.",
    description: "The PIN provided for the phone number does not match the configured PIN.",
    solution: "Verify the two-step verification PIN or reset it if necessary.",
    code: "WHATSAPP_CHANNEL_MISCONFIGURED",
  },
  133006: {
    title: "Phone Number Verification Required",
    userMessage: "This phone number needs to be verified before it can be registered.",
    description: "The phone number has not completed the required verification process.",
    solution: "Verify the phone number and then register it with WhatsApp Business Platform.",
    code: "WHATSAPP_CHANNEL_MISCONFIGURED",
  },
  133008: {
    title: "Too Many PIN Attempts",
    userMessage: "Too many incorrect PIN attempts. Please wait a while before trying again.",
    description: "The phone number has exceeded the allowed number of two-step verification PIN attempts.",
    solution: "Wait for the period specified by WhatsApp before trying again.",
    code: "META_RATE_LIMITED",
  },
  133009: {
    title: "PIN Attempted Too Quickly",
    userMessage: "Please wait a moment before trying the verification PIN again.",
    description: "Another two-step verification PIN attempt was made too quickly.",
    solution: "Wait for the period specified in the error details before trying again.",
    code: "META_RATE_LIMITED",
    retryable: true,
  },
  133010: {
    title: "Phone Number Not Registered",
    userMessage: "This phone number isn't registered with WhatsApp yet. Please register it first.",
    description: "The phone number has not been registered with WhatsApp Business Platform.",
    solution: "Register the phone number before attempting to send messages.",
    code: "WHATSAPP_CHANNEL_MISCONFIGURED",
  },
  133015: {
    title: "Recently Deleted Phone Number",
    userMessage: "This number was recently removed. Please wait a few minutes and try again.",
    description: "The phone number deletion process has not yet completed.",
    solution: "Wait at least 5 minutes and then try registering the phone number again.",
    code: "WHATSAPP_CHANNEL_MISCONFIGURED",
    retryable: true,
  },
  134011: {
    title: "WhatsApp Payments Terms Pending",
    userMessage: "WhatsApp Payments terms need to be accepted before you can continue.",
    description: "Acceptance of the WhatsApp Payments terms is pending for the WhatsApp Business Account.",
    solution: "Accept the WhatsApp Payments terms using the link provided in the error response.",
    code: "WHATSAPP_CHANNEL_MISCONFIGURED",
  },

  /* ---------------- Request problems ---------------- */
  100: {
    title: "Invalid Parameter",
    userMessage: "Something in this request isn't valid. Please double-check the details and try again.",
    description: "The request contains an unsupported, misspelled, incorrectly formatted, or invalid parameter.",
    solution: "Check the API request parameters and correct the invalid parameter or value.",
    code: "META_INVALID_REQUEST",
  },
  131008: {
    title: "Required Parameter Missing",
    userMessage: "This message is missing some required information. Please check the details and try again.",
    description: "The API request does not contain one or more required parameters.",
    solution: "Check the endpoint requirements and provide all mandatory parameters.",
    code: "META_INVALID_REQUEST",
  },
  131009: {
    title: "Invalid Parameter Value",
    userMessage: "One of the values in this message isn't valid. Please check it and try again.",
    description: "A parameter was provided, but its value is not supported or valid.",
    solution: "Check the supported values for the parameter and correct the request.",
    code: "META_INVALID_REQUEST",
  },
  131051: {
    title: "Unsupported Message Type",
    userMessage: "This message type isn't supported here. Please use a supported message format.",
    description: "The requested message type is not supported by the selected WhatsApp API operation.",
    solution: "Use a message type supported by the selected API.",
    code: "MESSAGE_SEND_FAILED",
  },
  135000: {
    title: "Unknown Request Parameter Error",
    userMessage: "This request contains information we couldn't process. Please try again or contact support.",
    description: "The request contains parameters that WhatsApp could not process correctly.",
    solution: "Check the API endpoint documentation and verify the request syntax and parameters.",
    code: "META_INVALID_REQUEST",
  },

  /* ---------------- Recipient / delivery ---------------- */
  130403: {
    title: "Customer Blocked the Business",
    userMessage: "This customer has blocked your store on WhatsApp, so this message couldn't be delivered.",
    description: "The WhatsApp user has blocked your business.",
    solution: "Do not send additional messages to this customer unless they unblock the business.",
    code: "MESSAGE_RECIPIENT_INVALID",
  },
  130472: {
    title: "Message Not Part of Experiment",
    userMessage: "This message couldn't be sent because it isn't part of an active WhatsApp test. Please check your configuration.",
    description: "The message was not sent as part of the applicable WhatsApp experiment.",
    solution: "Check whether the message is intended for the applicable experiment and follow the required experiment configuration.",
    code: "MESSAGE_SEND_FAILED",
  },
  130497: {
    title: "Country Messaging Restriction",
    userMessage: "Messages can't currently be sent to this customer's country. Please check WhatsApp's messaging restrictions.",
    description: "The WhatsApp Business Account has restrictions on messaging users in certain countries.",
    solution: "Check whether messaging is allowed for the destination country and whether your business is eligible.",
    code: "MESSAGE_RECIPIENT_INVALID",
  },
  131021: {
    title: "Invalid Recipient",
    userMessage: "This message couldn't be sent because the sender and recipient numbers are the same.",
    description: "The sender phone number and recipient phone number are identical.",
    solution: "Send the message to a different phone number.",
    code: "MESSAGE_RECIPIENT_INVALID",
  },
  131026: {
    title: "Message Could Not Be Delivered",
    userMessage: "This message couldn't be delivered. The customer may not have WhatsApp, may be using an outdated version, or hasn't accepted WhatsApp's latest terms.",
    description: "The recipient may not have WhatsApp, may not have accepted the latest WhatsApp terms, or may be using an outdated WhatsApp application.",
    solution: "Ask the customer to confirm they can message your WhatsApp number, accept the latest WhatsApp terms, and update WhatsApp to the latest version.",
    code: "MESSAGE_RECIPIENT_INVALID",
  },
  131030: {
    title: "Recipient Not in Allowed List",
    userMessage: "This number isn't on your test recipient list yet. Add it in the Meta developer dashboard, then try again.",
    description: "A test/sandbox phone number can only message numbers that have been added to its allowed recipient list.",
    solution: "Add the recipient to the allowed list in the Meta App Dashboard (WhatsApp > API Setup), or use a production phone number.",
    code: "MESSAGE_RECIPIENT_INVALID",
  },
  131047: {
    title: "24-Hour Messaging Window Expired",
    userMessage: "It's been more than 24 hours since this customer last messaged you, so only an approved template message can be sent.",
    description: "More than 24 hours have passed since the customer last replied to the business.",
    solution: "Send an approved WhatsApp template message instead of a free-form message.",
    code: "MESSAGE_WINDOW_EXPIRED",
  },
  131048: {
    title: "Messaging Quality Restriction",
    userMessage: "Your messaging is restricted because of a low quality rating. Please review your message content to improve engagement.",
    description: "The phone number may have sent too many messages that were blocked or reported as spam.",
    solution: "Check your WhatsApp quality status and template quality. Improve message quality and reduce unwanted messages.",
    code: "MESSAGE_SEND_FAILED",
  },
  131049: {
    title: "Message Blocked for Healthy Engagement",
    userMessage: "This message was temporarily blocked to protect the customer experience. Please wait before sending another.",
    description: "WhatsApp did not deliver the message to maintain healthy ecosystem engagement. This may be related to per-user marketing message limits.",
    solution: "Wait before sending another marketing message to this customer and avoid repeatedly sending the same template.",
    code: "MESSAGE_SEND_FAILED",
  },
  131050: {
    title: "Customer Opted Out of Marketing",
    userMessage: "This customer has opted out of marketing messages and can no longer receive them.",
    description: "The recipient has stopped receiving marketing messages from your business.",
    solution: "Do not send additional marketing messages to this customer unless their marketing preference changes.",
    code: "MESSAGE_SEND_FAILED",
  },

  /* ---------------- Media ---------------- */
  131052: {
    title: "Unable to Download Media",
    userMessage: "We couldn't download the media this customer sent. Please try again later.",
    description: "WhatsApp was unable to download media included in the customer's message.",
    solution: "Check the detailed error information and ask the customer to send the media using another method if necessary.",
    code: "FILE_UPLOAD_FAILED",
    retryable: true,
  },
  131053: {
    title: "Unable to Upload Media",
    userMessage: "This media file couldn't be uploaded. Please check the file type and size, then try again.",
    description: "The media could not be uploaded, possibly because the file type or MIME type is unsupported.",
    solution: "Check the media file type, MIME type, size, and supported WhatsApp media formats.",
    code: "FILE_UPLOAD_FAILED",
  },

  /* ---------------- Templates: sending ---------------- */
  131055: {
    title: "Marketing Templates Only",
    userMessage: "Only approved marketing templates can be used here. Please select a marketing template.",
    description: "A non-template, utility, or authentication template was submitted to the Marketing Messages API.",
    solution: "Use an approved marketing template when using the Marketing Messages API.",
    code: "MESSAGE_TEMPLATE_INVALID",
  },
  131063: {
    title: "Marketing Messages Disabled",
    userMessage: "Marketing messages are currently disabled for your account. Please check your settings.",
    description: "Marketing templates cannot currently be sent through the Cloud API configuration.",
    solution: "Use the Marketing Messages API or re-enable marketing messages on the Cloud API configuration.",
    code: "MESSAGE_TEMPLATE_INVALID",
  },
  131064: {
    title: "Messaging Limit Due to Template Classification",
    userMessage: "Messaging is limited because of a template classification issue. Please review your templates.",
    description: "The account has reached a messaging restriction caused by template classification violations.",
    solution: "Review your template classifications and make sure each template is categorized correctly.",
    code: "MESSAGE_TEMPLATE_INVALID",
  },
  132000: {
    title: "Template Parameter Count Mismatch",
    userMessage: "This template's variables don't match what's required. Please check the template and try again.",
    description: "The number of parameter values supplied does not match the number of variables defined in the template.",
    solution: "Check the template variables and provide exactly the required number of parameter values.",
    code: "MESSAGE_TEMPLATE_INVALID",
  },
  132001: {
    title: "Template Not Found or Not Approved",
    userMessage: "This template isn't available right now — it may not be approved yet, or doesn't exist in the selected language.",
    description: "The template does not exist in the specified language or has not been approved.",
    solution: "Verify the template name, language, and approval status.",
    code: "MESSAGE_TEMPLATE_INVALID",
  },
  132005: {
    title: "Template Translation Too Long",
    userMessage: "The translated version of this template is too long. Please shorten the content.",
    description: "The translated version of the template exceeds the allowed text length.",
    solution: "Shorten the translated template content.",
    code: "MESSAGE_TEMPLATE_INVALID",
  },
  132007: {
    title: "Template Policy Violation",
    userMessage: "This template doesn't comply with WhatsApp's policies. Please update the content and resubmit.",
    description: "The template content violates WhatsApp's template or messaging policies.",
    solution: "Review the template content and update it to comply with WhatsApp policies.",
    code: "MESSAGE_TEMPLATE_INVALID",
  },
  132012: {
    title: "Invalid Template Parameter Format",
    userMessage: "One of this template's values isn't formatted correctly. Please check it and try again.",
    description: "The parameter values do not match the format expected by the template.",
    solution: "Check the template parameter definitions and provide values in the required format.",
    code: "MESSAGE_TEMPLATE_INVALID",
  },
  132015: {
    title: "Template Paused Due to Low Quality",
    userMessage: "This template has been paused due to low quality. Please improve its content before using it again.",
    description: "WhatsApp has paused the template because its quality rating is too low.",
    solution: "Improve the template content and use the template again after it becomes available.",
    code: "MESSAGE_TEMPLATE_INVALID",
  },
  132016: {
    title: "Template Permanently Disabled",
    userMessage: "This template has been permanently disabled. Please create a new one with improved content.",
    description: "The template was paused too many times due to low quality and has been permanently disabled.",
    solution: "Create a new template with different and higher-quality content.",
    code: "MESSAGE_TEMPLATE_INVALID",
  },
  132018: {
    title: "Template Validation Error",
    userMessage: "This template's details couldn't be validated. Please correct them and try again.",
    description: "The supplied template parameters failed validation.",
    solution: "Review the template parameters, correct the invalid values, and send the message again.",
    code: "MESSAGE_TEMPLATE_INVALID",
  },
  134100: {
    title: "Only Marketing Messages Supported",
    userMessage: "Only marketing templates are supported here. Please select a marketing template.",
    description: "A utility or authentication template was submitted to the Marketing Messages API.",
    solution: "Use a template categorized as MARKETING.",
    code: "MESSAGE_TEMPLATE_INVALID",
  },
  134101: {
    title: "Template Still Synchronizing",
    userMessage: "This template is still syncing. Please try again in a few minutes.",
    description: "The template synchronization process has not completed yet.",
    solution: "Wait for template synchronization to complete and then try again.",
    code: "MESSAGE_TEMPLATE_INVALID",
    retryable: true,
  },
  134102: {
    title: "Marketing Template Unavailable",
    userMessage: "This marketing template isn't available right now. Please check your account's eligibility and try again.",
    description: "Template synchronization may have failed, or the WhatsApp Business Account may not be eligible for the Marketing Messages API.",
    solution: "Check the Marketing Messages API onboarding and eligibility status. If the account is onboarded and the problem continues, contact Meta support.",
    code: "MESSAGE_TEMPLATE_INVALID",
  },

  /* ---------------- Templates: management ---------------- */
  2388019: {
    title: "Message Template Limit Exceeded",
    userMessage: "You've reached your template limit. Please remove any unused templates before creating new ones.",
    description: "The account has reached the maximum number of message templates allowed.",
    solution: "Review your existing templates and remove templates that are no longer required.",
    code: "MESSAGE_TEMPLATE_INVALID",
  },
  2388039: {
    title: "Template Cannot Be Changed",
    userMessage: "This template can't be edited right now, likely because it's under review. Please try again later.",
    description: "The template is currently in a state where its status cannot be changed, such as being under review.",
    solution: "Wait until the template is approved or rejected before making changes.",
    code: "MESSAGE_TEMPLATE_INVALID",
  },
  2388040: {
    title: "Template Character Limit Exceeded",
    userMessage: "This template is too long. Please shorten it and try again.",
    description: "One of the template fields exceeds the maximum allowed character limit.",
    solution: "Shorten the affected template field.",
    code: "MESSAGE_TEMPLATE_INVALID",
  },
  2388047: {
    title: "Invalid Template Header",
    userMessage: "The template header isn't formatted correctly. Please review and correct it.",
    description: "The template header contains unsupported formatting.",
    solution: "Review and correct the template header format.",
    code: "MESSAGE_TEMPLATE_INVALID",
  },
  2388072: {
    title: "Invalid Template Body",
    userMessage: "The template body isn't formatted correctly. Please review and correct it.",
    description: "The template body does not follow WhatsApp's required formatting rules.",
    solution: "Review and correct the template body formatting.",
    code: "MESSAGE_TEMPLATE_INVALID",
  },
  2388073: {
    title: "Invalid Template Footer",
    userMessage: "The template footer isn't formatted correctly. Please review and correct it.",
    description: "The template footer does not follow WhatsApp's supported formatting rules.",
    solution: "Review and correct the template footer.",
    code: "MESSAGE_TEMPLATE_INVALID",
  },
  2388293: {
    title: "Too Many Template Variables",
    userMessage: "This template has too many variables for its length. Please reduce the variables or add more text.",
    description: "The number of variables is too high compared with the amount of text in the template.",
    solution: "Reduce the number of variables or increase the message length.",
    code: "MESSAGE_TEMPLATE_INVALID",
  },
  2388299: {
    title: "Invalid Variable Position",
    userMessage: "Variables can't sit at the very start or end of a template. Please add some text around them.",
    description: "One or more variables are positioned at the beginning or end of the template.",
    solution: "Add appropriate text before or after the variable.",
    code: "MESSAGE_TEMPLATE_INVALID",
  },

  /* ---------------- Template insights ---------------- */
  200005: {
    title: "Template Insights Unavailable",
    userMessage: "Template analytics aren't available for your account right now.",
    description: "Template Insights are not currently available for this WhatsApp Business Account.",
    solution: "Check the account's eligibility for Template Insights.",
    code: "META_INVALID_REQUEST",
  },
  200006: {
    title: "Template Insights Cannot Be Disabled",
    userMessage: "Template analytics can't be turned off once enabled — no action is needed.",
    description: "Template Insights does not support being disabled after activation.",
    solution: "No action is required.",
    code: "META_INVALID_REQUEST",
  },
  200007: {
    title: "Template Insights Not Enabled",
    userMessage: "Template analytics haven't been turned on yet. Please enable Template Insights to view them.",
    description: "Template Insights have not been enabled for the account.",
    solution: "Enable Template Insights for the WhatsApp Business Account.",
    code: "META_INVALID_REQUEST",
  },

  /* ---------------- Onboarding & migration ---------------- */
  2388012: {
    title: "Phone Number Already Exists",
    userMessage: "This phone number is already in use on the destination account. Please use a different number.",
    description: "The phone number being migrated already exists in the destination WhatsApp account.",
    solution: "Use a phone number that is not already registered in the destination account.",
    code: "WHATSAPP_CONNECT_FAILED",
  },
  2388091: {
    title: "Phone Number Not Eligible for Migration",
    userMessage: "This phone number can't receive a migration code. Please verify it using the standard registration process.",
    description: "The phone number is not eligible for the migration verification process.",
    solution: "Register and verify the phone number using the supported registration process.",
    code: "WHATSAPP_CONNECT_FAILED",
  },
  2388093: {
    title: "Phone Number Not Eligible for Migration",
    userMessage: "This phone number can't be verified for migration. Please use the standard registration process instead.",
    description: "Phone ownership verification is not available for this migration scenario.",
    solution: "Register and verify the phone number using the supported registration process.",
    code: "WHATSAPP_CONNECT_FAILED",
  },
  2388103: {
    title: "Phone Number Migration Failed",
    userMessage: "This phone number couldn't be migrated. Please check your account settings and try again.",
    description: "The migration may have failed because of account configuration, webhook, approval, payment, ownership, or registration issues.",
    solution: "Check the detailed error message and verify the WhatsApp Business Account, phone number, webhook, payment, ownership, and approval configuration.",
    code: "WHATSAPP_CONNECT_FAILED",
  },
  2593079: {
    title: "WABA Migration Already Started",
    userMessage: "This WhatsApp account is already being migrated. Please wait for the process to finish before trying again.",
    description: "The WABA has already been marked for migration to another solution.",
    solution: "Do not start another migration. Contact Meta support if the migration needs to be investigated.",
    code: "WHATSAPP_CONNECT_FAILED",
  },
  2593085: {
    title: "WABA Not Eligible for Ownership Transfer",
    userMessage: "This WhatsApp account can't be transferred right now. Please check its ownership status.",
    description: "The WABA may already be owned by the business customer or the required ownership request may not have been accepted.",
    solution: "Verify the WABA ownership status and required approval in Meta Business Suite.",
    code: "WHATSAPP_CONNECT_FAILED",
  },
  2593107: {
    title: "Synchronization Limit Reached",
    userMessage: "You've reached the sync limit for this account. Please reconnect your WhatsApp account to sync again.",
    description: "The synchronization API has already been called the maximum allowed number of times.",
    solution: "Offboard and re-onboard the business customer if synchronization is required again.",
    code: "WHATSAPP_CONNECT_FAILED",
  },
  2593108: {
    title: "Synchronization Window Expired",
    userMessage: "The sync window for this account has expired. Please reconnect your WhatsApp account.",
    description: "Synchronization can only be initiated within 24 hours of onboarding.",
    solution: "Offboard and re-onboard the user if synchronization is required.",
    code: "WHATSAPP_CONNECT_FAILED",
  },
  1752041: {
    title: "Duplicate Onboarding Request",
    userMessage: "An onboarding request is already in progress for this account — no further action is needed.",
    description: "Another partner has already submitted an onboarding request for this business customer.",
    solution: "No additional onboarding request is required. Continue with the existing onboarding process.",
    code: "WHATSAPP_CONNECT_FAILED",
  },
};
