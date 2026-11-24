-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "emailVerifiedAt" DATETIME,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "role" TEXT NOT NULL DEFAULT 'user',
    "status" TEXT NOT NULL DEFAULT 'active',
    "lastLoginAt" DATETIME,
    "inviteCode" TEXT,
    "tokenVersion" INTEGER NOT NULL DEFAULT 0,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "tempPasswordExpiresAt" DATETIME,
    "phone" TEXT,
    "phoneVerifiedAt" DATETIME
);

-- CreateTable
CREATE TABLE "OAuthIdentity" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastLoginAt" DATETIME,
    CONSTRAINT "OAuthIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OAuthChallenge" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tokenHash" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "userId" TEXT,
    "linkUserId" TEXT,
    "returnTo" TEXT,
    "expiresAt" DATETIME NOT NULL,
    "usedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "AdminRole" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "permissions" TEXT NOT NULL DEFAULT '[]',
    "builtIn" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "type" TEXT NOT NULL DEFAULT 'credits',
    "priceCents" INTEGER NOT NULL,
    "originalPriceCents" INTEGER,
    "credits" INTEGER NOT NULL,
    "creditsValidDays" INTEGER NOT NULL DEFAULT 0,
    "grantType" TEXT NOT NULL DEFAULT 'immediate',
    "status" TEXT NOT NULL DEFAULT 'active',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "kind" TEXT NOT NULL DEFAULT 'credits',
    "saleStrategy" TEXT NOT NULL DEFAULT 'unlimited',
    "periodDays" INTEGER NOT NULL DEFAULT 0,
    "periodPurchaseLimit" INTEGER NOT NULL DEFAULT 0,
    "stockTotal" INTEGER NOT NULL DEFAULT 0,
    "stockReserved" INTEGER NOT NULL DEFAULT 0,
    "stockSold" INTEGER NOT NULL DEFAULT 0,
    "saleStartAt" DATETIME,
    "saleEndAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderNo" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "discountCents" INTEGER NOT NULL DEFAULT 0,
    "paidCents" INTEGER NOT NULL DEFAULT 0,
    "refundedCents" INTEGER NOT NULL DEFAULT 0,
    "grantedCredits" INTEGER NOT NULL DEFAULT 0,
    "couponId" TEXT,
    "campaignId" TEXT,
    "couponSnapshot" TEXT NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "channel" TEXT NOT NULL DEFAULT 'sandbox',
    "paidAt" DATETIME,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "providerConfigId" TEXT,
    "providerConfigVersion" INTEGER,
    "providerInstanceId" TEXT,
    "providerTradeNo" TEXT,
    "providerStatus" TEXT,
    "checkoutMode" TEXT,
    "checkoutValue" TEXT DEFAULT '',
    "checkoutExpiresAt" DATETIME,
    "lastQueriedAt" DATETIME,
    "lastError" TEXT,
    "closeStartedAt" DATETIME,
    "intentStartedAt" DATETIME,
    "closedAt" DATETIME,
    "providerPaidAt" DATETIME,
    "stockReserved" BOOLEAN NOT NULL DEFAULT false,
    "membershipPlanId" TEXT,
    "membershipAppliedAt" DATETIME,
    "membershipPeriodStartAt" DATETIME,
    "membershipPeriodEndAt" DATETIME,
    "membershipPerksSnapshot" TEXT,
    "membershipMonthlyCreditsSnapshot" INTEGER,
    "membershipDurationDaysSnapshot" INTEGER,
    "membershipUserGroupCodeSnapshot" TEXT,
    "membershipPeriodRevokedAt" DATETIME,
    CONSTRAINT "Order_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Order_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "Coupon" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Order_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Order_membershipPlanId_fkey" FOREIGN KEY ("membershipPlanId") REFERENCES "MembershipPlan" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OrderCancelEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'reserved',
    "windowMode" TEXT NOT NULL,
    "windowStart" DATETIME NOT NULL,
    "windowEnd" DATETIME NOT NULL,
    "reservedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "consumedAt" DATETIME,
    "releasedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "OrderCancelEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "OrderCancelEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "skuSnapshot" TEXT NOT NULL,
    "nameSnapshot" TEXT NOT NULL,
    "priceCentsSnapshot" INTEGER NOT NULL,
    "creditsSnapshot" INTEGER NOT NULL,
    "validDaysSnapshot" INTEGER NOT NULL,
    "grantTypeSnapshot" TEXT,
    "stockReservedSnapshot" INTEGER,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "OrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "payTransactionId" TEXT,
    "channel" TEXT NOT NULL DEFAULT 'sandbox',
    "providerMethod" TEXT,
    "amountCents" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "message" TEXT,
    "sandboxScenario" TEXT,
    "rawPayload" TEXT NOT NULL DEFAULT '',
    "paidAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "providerConfigId" TEXT,
    "providerConfigVersion" INTEGER,
    "providerInstanceId" TEXT,
    "providerRef" TEXT,
    "providerStatus" TEXT,
    "lastError" TEXT,
    "closedAt" DATETIME,
    CONSTRAINT "Payment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Payment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Refund" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "creditsReclaimed" INTEGER NOT NULL DEFAULT 0,
    "creditsUnreclaimable" INTEGER NOT NULL DEFAULT 0,
    "creditsExpired" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'succeeded',
    "reason" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "providerRefundId" TEXT,
    "detail" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Refund_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Refund_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Refund_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CreditLot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "orderId" TEXT,
    "totalMicrocredits" BIGINT NOT NULL,
    "remainingMicrocredits" BIGINT NOT NULL,
    "expireAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CreditLot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CreditLedger" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "lotId" TEXT,
    "orderId" TEXT,
    "taskId" TEXT,
    "idempotencyKey" TEXT,
    "reason" TEXT,
    "operatorId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CreditLedger_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CreditLedger_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "CreditLot" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MembershipPlan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "priceCents" INTEGER NOT NULL DEFAULT 0,
    "durationDays" INTEGER NOT NULL DEFAULT 0,
    "monthlyCredits" INTEGER NOT NULL DEFAULT 0,
    "perks" TEXT NOT NULL DEFAULT '{}',
    "userGroupCode" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'active',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "perksSnapshot" TEXT NOT NULL DEFAULT '{}',
    "monthlyCreditsSnapshot" INTEGER NOT NULL DEFAULT 0,
    "startAt" DATETIME NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "orderId" TEXT,
    "nextCreditAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Membership_planId_fkey" FOREIGN KEY ("planId") REFERENCES "MembershipPlan" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Membership_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MembershipUsage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "orderId" TEXT,
    "savedCents" INTEGER NOT NULL DEFAULT 0,
    "planCode" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MembershipUsage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "MembershipUsage_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SystemSetting" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL,
    "updatedBy" TEXT,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "BackupRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "filename" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "trigger" TEXT NOT NULL DEFAULT 'scheduled',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "errorMessage" TEXT,
    "sourceSizeBytes" INTEGER,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "verifiedAt" DATETIME,
    "verifyReport" TEXT,
    "verifyWarnings" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "CleanupLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "target" TEXT NOT NULL,
    "deletedCount" INTEGER NOT NULL,
    "retentionDays" INTEGER NOT NULL,
    "trigger" TEXT NOT NULL DEFAULT 'scheduled',
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "detail" TEXT NOT NULL DEFAULT '{}',
    "success" BOOLEAN NOT NULL DEFAULT true,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" DATETIME,
    CONSTRAINT "Project_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "capability" TEXT,
    "sourceUrl" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "format" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "durationMs" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'visible',
    "storageBackend" TEXT NOT NULL DEFAULT 'local',
    "storageKey" TEXT,
    "sourceSite" TEXT,
    "sourceTitle" TEXT,
    "sourcePageUrl" TEXT,
    "aigcMeta" TEXT NOT NULL DEFAULT '{}',
    "aigcLabeledAt" DATETIME,
    CONSTRAINT "Asset_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Asset_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GenerationTask" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "capability" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "inputAssetIds" TEXT NOT NULL,
    "outputAssetId" TEXT,
    "outputAssetIds" TEXT,
    "params" TEXT NOT NULL,
    "provider" TEXT,
    "errorCode" TEXT,
    "creditCost" INTEGER NOT NULL DEFAULT 0,
    "parentTaskId" TEXT,
    "idempotencyKey" TEXT,
    "requestFingerprint" TEXT,
    "retriedFromId" TEXT,
    "retryKey" TEXT,
    "heartbeatAt" DATETIME,
    "modelKey" TEXT,
    "channelModelId" TEXT,
    "channelId" TEXT,
    "routeRun" INTEGER NOT NULL DEFAULT 1,
    "billingOrderId" TEXT,
    "clientIp" TEXT NOT NULL DEFAULT '',
    "providerRequestId" TEXT,
    "pollStage" TEXT NOT NULL DEFAULT '',
    "nextPollAt" DATETIME,
    "leaseOwner" TEXT NOT NULL DEFAULT '',
    "leaseUntil" DATETIME,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "stage" TEXT NOT NULL DEFAULT '',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "authorizedChargeMicrocredits" BIGINT NOT NULL DEFAULT 0,
    "mediaRecoveryError" TEXT,
    "pendingResult" TEXT,
    "aigcMeta" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "GenerationTask_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "GenerationTask_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "GenerationTask_outputAssetId_fkey" FOREIGN KEY ("outputAssetId") REFERENCES "Asset" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Coupon" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "value" INTEGER NOT NULL,
    "thresholdCents" INTEGER NOT NULL DEFAULT 0,
    "scope" TEXT NOT NULL DEFAULT 'all',
    "productIds" TEXT NOT NULL DEFAULT '[]',
    "totalCount" INTEGER NOT NULL DEFAULT 0,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "perUserLimit" INTEGER NOT NULL DEFAULT 1,
    "validFrom" DATETIME NOT NULL,
    "validTo" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'on',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" TEXT NOT NULL DEFAULT '{}',
    "startAt" DATETIME NOT NULL,
    "endAt" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "audience" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "InviteRelation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "inviteCode" TEXT NOT NULL,
    "inviterId" TEXT NOT NULL,
    "inviteeId" TEXT NOT NULL,
    "boundAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rewardStatus" TEXT NOT NULL DEFAULT 'pending',
    CONSTRAINT "InviteRelation_inviterId_fkey" FOREIGN KEY ("inviterId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "InviteRelation_inviteeId_fkey" FOREIGN KEY ("inviteeId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InviteRewardRule" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'default',
    "inviterCredits" INTEGER NOT NULL DEFAULT 0,
    "inviteeCredits" INTEGER NOT NULL DEFAULT 0,
    "triggerOn" TEXT NOT NULL DEFAULT 'first_pay',
    "valid" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "CheckinRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "credits" INTEGER NOT NULL,
    "streak" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CheckinRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CheckinRule" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'default',
    "baseCredits" INTEGER NOT NULL DEFAULT 5,
    "bonusRules" TEXT NOT NULL DEFAULT '[]',
    "maxStreak" INTEGER NOT NULL DEFAULT 0,
    "dailyCap" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "AccountToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "type" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "usedAt" DATETIME,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "requestedIp" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AccountToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PaymentExceptionCase" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fingerprint" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "orderId" TEXT,
    "merchantOrderNo" TEXT NOT NULL,
    "providerTradeNo" TEXT,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "priority" TEXT NOT NULL DEFAULT 'urgent',
    "ownerId" TEXT,
    "slaDueAt" DATETIME NOT NULL,
    "refundId" TEXT,
    "resolution" TEXT,
    "lastError" TEXT,
    "closedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "PaymentAutoReconcileState" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "providerId" TEXT NOT NULL,
    "providerInstanceId" TEXT NOT NULL DEFAULT 'default',
    "billDate" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "LoginLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "email" TEXT NOT NULL,
    "ip" TEXT,
    "ua" TEXT,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "reason" TEXT NOT NULL DEFAULT 'password',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LoginLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LoginSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tokenHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "userId" TEXT,
    "ip" TEXT,
    "ua" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    "scannedAt" DATETIME,
    "confirmedAt" DATETIME,
    "consumedAt" DATETIME,
    CONSTRAINT "LoginSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "invoiceNo" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "activeOrderId" TEXT,
    "userId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'personal',
    "title" TEXT NOT NULL,
    "taxNo" TEXT,
    "email" TEXT,
    "content" TEXT NOT NULL DEFAULT '技术服务费',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "rejectReason" TEXT,
    "fileKey" TEXT,
    "issuedAt" DATETIME,
    "issuedBy" TEXT,
    "redFlushedAt" DATETIME,
    "redFlushedBy" TEXT,
    "redFlushReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Invoice_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Invoice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ReconciliationBatch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "channel" TEXT NOT NULL,
    "billDate" TEXT NOT NULL,
    "fileName" TEXT,
    "channelCount" INTEGER NOT NULL DEFAULT 0,
    "channelAmountCents" INTEGER NOT NULL DEFAULT 0,
    "localCount" INTEGER NOT NULL DEFAULT 0,
    "localAmountCents" INTEGER NOT NULL DEFAULT 0,
    "matchedCount" INTEGER NOT NULL DEFAULT 0,
    "diffCount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'imported',
    "operatorId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ReconciliationItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "batchId" TEXT NOT NULL,
    "tradeNo" TEXT NOT NULL,
    "paymentId" TEXT,
    "orderId" TEXT,
    "diffType" TEXT NOT NULL,
    "channelAmountCents" INTEGER NOT NULL,
    "localAmountCents" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'open',
    "note" TEXT,
    "resolvedBy" TEXT,
    "resolvedAt" DATETIME,
    CONSTRAINT "ReconciliationItem_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ReconciliationBatch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "link" TEXT,
    "readAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MessageTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "CapabilityControl" (
    "capabilityId" TEXT NOT NULL PRIMARY KEY,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "reason" TEXT,
    "updatedBy" TEXT,
    "updatedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Ticket" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ticketNo" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "orderId" TEXT,
    "assetId" TEXT,
    "assigneeId" TEXT,
    "resolvedAt" DATETIME,
    "closedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Ticket_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TicketReply" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ticketId" TEXT NOT NULL,
    "authorType" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "visibility" TEXT NOT NULL DEFAULT 'public',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TicketReply_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AigcLabelConfig" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'default',
    "specJson" TEXT NOT NULL,
    "specKey" TEXT NOT NULL,
    "pngBase64" TEXT,
    "pngWidth" INTEGER,
    "pngHeight" INTEGER,
    "updatedBy" TEXT,
    "updatedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ModelChannel" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL DEFAULT '',
    "scope" TEXT NOT NULL DEFAULT 'system',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "baseUrl" TEXT NOT NULL DEFAULT '',
    "apiKey" TEXT NOT NULL DEFAULT '',
    "secretKey" TEXT NOT NULL DEFAULT '',
    "apiFormat" TEXT NOT NULL DEFAULT 'openai',
    "concurrencyLimit" INTEGER NOT NULL DEFAULT 0,
    "proxyUrl" TEXT NOT NULL DEFAULT '',
    "modelsJson" TEXT NOT NULL DEFAULT '[]',
    "retiredModelsJson" TEXT NOT NULL DEFAULT '[]',
    "headersJson" TEXT NOT NULL DEFAULT '',
    "catalogProviderId" TEXT NOT NULL DEFAULT '',
    "defaultModelConfigJson" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME
);

-- CreateTable
CREATE TABLE "ChannelModel" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "channelId" TEXT NOT NULL,
    "modelKey" TEXT NOT NULL,
    "activeKey" TEXT,
    "providerModelKey" TEXT NOT NULL DEFAULT '',
    "displayName" TEXT NOT NULL DEFAULT '',
    "channelLabel" TEXT NOT NULL DEFAULT '',
    "tags" TEXT NOT NULL DEFAULT '[]',
    "description" TEXT NOT NULL DEFAULT '',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "icon" TEXT NOT NULL DEFAULT '',
    "capability" TEXT NOT NULL,
    "protocol" TEXT NOT NULL,
    "billingMode" TEXT NOT NULL DEFAULT 'fixed_request',
    "unitPriceMicrocredits" BIGINT NOT NULL DEFAULT 0,
    "inputTokenPriceMicrocredits" BIGINT NOT NULL DEFAULT 0,
    "outputTokenPriceMicrocredits" BIGINT NOT NULL DEFAULT 0,
    "cachedTokenPriceMicrocredits" BIGINT NOT NULL DEFAULT 0,
    "priceConfigured" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "priceVersion" INTEGER NOT NULL DEFAULT 0,
    "priceCurrency" TEXT NOT NULL DEFAULT 'credits',
    "capabilityConfigJson" TEXT NOT NULL DEFAULT '',
    "capabilityVersion" INTEGER NOT NULL DEFAULT 0,
    "modelGroupKey" TEXT NOT NULL DEFAULT '',
    "catalogModelKey" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME
);

-- CreateTable
CREATE TABLE "ChannelModelPriceTier" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "channelModelId" TEXT NOT NULL,
    "activeKey" TEXT,
    "selectorKey" TEXT NOT NULL DEFAULT '{}',
    "selectorJson" TEXT NOT NULL DEFAULT '{}',
    "resolution" TEXT NOT NULL DEFAULT '*',
    "videoSeconds" INTEGER NOT NULL DEFAULT 0,
    "providerModelKey" TEXT NOT NULL DEFAULT '',
    "billingMode" TEXT NOT NULL DEFAULT 'fixed_request',
    "costConfigured" BOOLEAN NOT NULL DEFAULT false,
    "costUnitPriceMicrocredits" BIGINT NOT NULL DEFAULT 0,
    "costInputTokenPriceMicrocredits" BIGINT NOT NULL DEFAULT 0,
    "costOutputTokenPriceMicrocredits" BIGINT NOT NULL DEFAULT 0,
    "costCachedTokenPriceMicrocredits" BIGINT NOT NULL DEFAULT 0,
    "unitPriceMicrocredits" BIGINT NOT NULL DEFAULT 0,
    "inputTokenPriceMicrocredits" BIGINT NOT NULL DEFAULT 0,
    "outputTokenPriceMicrocredits" BIGINT NOT NULL DEFAULT 0,
    "cachedTokenPriceMicrocredits" BIGINT NOT NULL DEFAULT 0,
    "priceConfigured" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "priceVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME
);

-- CreateTable
CREATE TABLE "CapabilityModelBinding" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "capabilityId" TEXT NOT NULL,
    "channelModelId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "weight" INTEGER NOT NULL DEFAULT 100,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "CapabilityPricing" (
    "capabilityId" TEXT NOT NULL PRIMARY KEY,
    "billingMode" TEXT NOT NULL DEFAULT 'fixed_request',
    "unitPriceMicrocredits" BIGINT NOT NULL DEFAULT 0,
    "inputTokenPriceMicrocredits" BIGINT NOT NULL DEFAULT 0,
    "outputTokenPriceMicrocredits" BIGINT NOT NULL DEFAULT 0,
    "cachedTokenPriceMicrocredits" BIGINT NOT NULL DEFAULT 0,
    "updatedBy" TEXT NOT NULL DEFAULT '',
    "updatedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "RouteAttempt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "routeRun" INTEGER NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "capabilityId" TEXT NOT NULL DEFAULT '',
    "modelKey" TEXT NOT NULL DEFAULT '',
    "channelModelId" TEXT NOT NULL DEFAULT '',
    "channelId" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'selected',
    "dispatchState" TEXT NOT NULL DEFAULT 'not_sent',
    "providerRequestId" TEXT NOT NULL DEFAULT '',
    "failureCode" TEXT NOT NULL DEFAULT '',
    "failureMessage" TEXT NOT NULL DEFAULT '',
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME
);

-- CreateTable
CREATE TABLE "UserGroup" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "activeKey" TEXT,
    "name" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "badgeLabel" TEXT NOT NULL DEFAULT '',
    "badgeStyle" TEXT NOT NULL DEFAULT 'none',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "ratioBasisPoints" INTEGER NOT NULL DEFAULT 10000,
    "pointsPerUsd" BIGINT NOT NULL DEFAULT 0,
    "pointsPerCny" BIGINT NOT NULL DEFAULT 0,
    "allChannels" BOOLEAN NOT NULL DEFAULT false,
    "modelOverridesJson" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME
);

-- CreateTable
CREATE TABLE "UserGroupChannel" (
    "groupId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("groupId", "channelId")
);

-- CreateTable
CREATE TABLE "BillingOrder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "taskId" TEXT NOT NULL DEFAULT '',
    "channelId" TEXT NOT NULL DEFAULT '',
    "channelModelId" TEXT NOT NULL DEFAULT '',
    "priceTierId" TEXT NOT NULL DEFAULT '',
    "priceTierVersion" INTEGER NOT NULL DEFAULT 0,
    "priceSelectorJson" TEXT NOT NULL DEFAULT '{}',
    "model" TEXT NOT NULL DEFAULT '',
    "capability" TEXT NOT NULL DEFAULT '',
    "scene" TEXT NOT NULL DEFAULT '',
    "billingMode" TEXT NOT NULL DEFAULT 'fixed_request',
    "priceVersion" INTEGER NOT NULL DEFAULT 0,
    "unitPriceMicrocredits" BIGINT NOT NULL DEFAULT 0,
    "multiplierBasisPoints" BIGINT NOT NULL DEFAULT 10000,
    "userGroup" TEXT NOT NULL DEFAULT '',
    "priceCurrency" TEXT NOT NULL DEFAULT '',
    "currencyRateMicrocredits" BIGINT NOT NULL DEFAULT 0,
    "quantity" BIGINT NOT NULL DEFAULT 1,
    "amountMicrocredits" BIGINT NOT NULL DEFAULT 0,
    "reservedAmountMicrocredits" BIGINT NOT NULL DEFAULT 0,
    "chargeLimitSet" BOOLEAN NOT NULL DEFAULT false,
    "chargeLimitMicrocredits" BIGINT NOT NULL DEFAULT 0,
    "actualAmountMicrocredits" BIGINT NOT NULL DEFAULT 0,
    "refundedAmountMicrocredits" BIGINT NOT NULL DEFAULT 0,
    "inputTokenPriceMicrocredits" BIGINT NOT NULL DEFAULT 0,
    "outputTokenPriceMicrocredits" BIGINT NOT NULL DEFAULT 0,
    "cachedTokenPriceMicrocredits" BIGINT NOT NULL DEFAULT 0,
    "inputTokens" BIGINT NOT NULL DEFAULT 0,
    "outputTokens" BIGINT NOT NULL DEFAULT 0,
    "cachedTokens" BIGINT NOT NULL DEFAULT 0,
    "videoFormulaTokens" BIGINT NOT NULL DEFAULT 0,
    "usageSource" TEXT NOT NULL DEFAULT '',
    "usageAvailable" BOOLEAN NOT NULL DEFAULT false,
    "costConfigured" BOOLEAN NOT NULL DEFAULT false,
    "costUnitPriceMicrocredits" BIGINT NOT NULL DEFAULT 0,
    "costInputTokenPriceMicrocredits" BIGINT NOT NULL DEFAULT 0,
    "costOutputTokenPriceMicrocredits" BIGINT NOT NULL DEFAULT 0,
    "costCachedTokenPriceMicrocredits" BIGINT NOT NULL DEFAULT 0,
    "costBillingMode" TEXT NOT NULL DEFAULT '',
    "costQuantity" BIGINT NOT NULL DEFAULT 0,
    "costVideoFormulaTokens" BIGINT NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'reserved',
    "providerRequestId" TEXT NOT NULL DEFAULT '',
    "promotionId" TEXT NOT NULL DEFAULT '',
    "errorText" TEXT NOT NULL DEFAULT '',
    "resolvedBy" TEXT NOT NULL DEFAULT '',
    "resolutionNote" TEXT NOT NULL DEFAULT '',
    "reviewBatchId" TEXT NOT NULL DEFAULT '',
    "startedAt" DATETIME,
    "settledAt" DATETIME,
    "refundedAt" DATETIME,
    "refundReason" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "CreditAccount" (
    "userId" TEXT NOT NULL PRIMARY KEY,
    "availableMicrocredits" BIGINT NOT NULL DEFAULT 0,
    "reservedMicrocredits" BIGINT NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "CreditLedgerEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amountMicrocredits" BIGINT NOT NULL,
    "availableDeltaMicrocredits" BIGINT NOT NULL DEFAULT 0,
    "reservedDeltaMicrocredits" BIGINT NOT NULL DEFAULT 0,
    "availableAfterMicrocredits" BIGINT NOT NULL,
    "reservedAfterMicrocredits" BIGINT NOT NULL,
    "billingOrderId" TEXT NOT NULL DEFAULT '',
    "paymentOrderId" TEXT NOT NULL DEFAULT '',
    "lotId" TEXT NOT NULL DEFAULT '',
    "taskId" TEXT NOT NULL DEFAULT '',
    "actorUserId" TEXT NOT NULL DEFAULT '',
    "model" TEXT NOT NULL DEFAULT '',
    "channelId" TEXT NOT NULL DEFAULT '',
    "scene" TEXT NOT NULL DEFAULT '',
    "businessType" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "referenceKey" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "CreditReservationItem" (
    "billingOrderId" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "microcredits" BIGINT NOT NULL,

    PRIMARY KEY ("billingOrderId", "lotId")
);

-- CreateTable
CREATE TABLE "ApiCallLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL DEFAULT '',
    "traceId" TEXT NOT NULL DEFAULT '',
    "requestId" TEXT NOT NULL DEFAULT '',
    "channelId" TEXT NOT NULL DEFAULT '',
    "channelName" TEXT NOT NULL DEFAULT '',
    "channelModelId" TEXT NOT NULL DEFAULT '',
    "taskId" TEXT NOT NULL DEFAULT '',
    "billingOrderId" TEXT NOT NULL DEFAULT '',
    "source" TEXT NOT NULL DEFAULT '',
    "capability" TEXT NOT NULL DEFAULT '',
    "operation" TEXT NOT NULL DEFAULT '',
    "requestKind" TEXT NOT NULL DEFAULT '',
    "billable" BOOLEAN NOT NULL DEFAULT false,
    "apiFormat" TEXT NOT NULL DEFAULT '',
    "method" TEXT NOT NULL DEFAULT '',
    "path" TEXT NOT NULL DEFAULT '',
    "model" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT '',
    "statusCode" INTEGER NOT NULL DEFAULT 0,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "pollCount" INTEGER NOT NULL DEFAULT 0,
    "providerStatus" TEXT NOT NULL DEFAULT '',
    "inputTokens" BIGINT NOT NULL DEFAULT 0,
    "outputTokens" BIGINT NOT NULL DEFAULT 0,
    "cachedTokens" BIGINT NOT NULL DEFAULT 0,
    "usageAvailable" BOOLEAN NOT NULL DEFAULT false,
    "mediaCount" INTEGER NOT NULL DEFAULT 0,
    "videoSeconds" INTEGER NOT NULL DEFAULT 0,
    "providerRequestId" TEXT NOT NULL DEFAULT '',
    "estimatedCostMicros" BIGINT NOT NULL DEFAULT 0,
    "costAvailable" BOOLEAN NOT NULL DEFAULT false,
    "currency" TEXT NOT NULL DEFAULT '',
    "errorCode" TEXT NOT NULL DEFAULT '',
    "error" TEXT NOT NULL DEFAULT '',
    "concurrencyLimit" INTEGER NOT NULL DEFAULT 0,
    "upstreamUrl" TEXT NOT NULL DEFAULT '',
    "requestContentType" TEXT NOT NULL DEFAULT '',
    "requestBody" TEXT NOT NULL DEFAULT '',
    "responseBody" TEXT NOT NULL DEFAULT '',
    "clientIp" TEXT NOT NULL DEFAULT '',
    "requestBytes" INTEGER NOT NULL DEFAULT 0,
    "responseBytes" INTEGER NOT NULL DEFAULT 0,
    "startedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "PluginPlatformState" (
    "pluginId" TEXT NOT NULL PRIMARY KEY,
    "source" TEXT NOT NULL DEFAULT 'builtin',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "verifyJson" TEXT NOT NULL DEFAULT '{}',
    "updatedBy" TEXT NOT NULL DEFAULT '',
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "UserPluginState" (
    "userId" TEXT NOT NULL,
    "pluginId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,

    PRIMARY KEY ("userId", "pluginId")
);

-- CreateTable
CREATE TABLE "RouteCatalogVersion" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'catalog',
    "version" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "PaymentProviderConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "providerId" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL DEFAULT 'default',
    "name" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "closeAfterMinutes" INTEGER NOT NULL DEFAULT 30,
    "minAmountCents" INTEGER,
    "maxAmountCents" INTEGER,
    "dailyLimitCents" INTEGER,
    "refundEnabled" BOOLEAN NOT NULL DEFAULT true,
    "paymentMethods" TEXT NOT NULL DEFAULT '["alipay","wechat"]',
    "configCipher" TEXT NOT NULL DEFAULT '',
    "configDigest" TEXT NOT NULL DEFAULT '',
    "createdBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "PaymentRoundRobinCursor" (
    "providerId" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "cursor" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL,

    PRIMARY KEY ("providerId", "method")
);

-- CreateTable
CREATE TABLE "PaymentNotification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "providerId" TEXT NOT NULL,
    "providerEventId" TEXT NOT NULL,
    "providerConfigId" TEXT NOT NULL,
    "merchantOrderNo" TEXT NOT NULL,
    "orderId" TEXT,
    "payloadDigest" TEXT NOT NULL,
    "payloadCipher" TEXT NOT NULL DEFAULT '',
    "normalizedJson" TEXT NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "nextAttemptAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "PaymentReconciliationRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "providerId" TEXT NOT NULL,
    "providerInstanceId" TEXT NOT NULL DEFAULT 'default',
    "configId" TEXT,
    "billDate" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "source" TEXT NOT NULL DEFAULT 'provider',
    "fileName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'running',
    "totalItems" INTEGER NOT NULL DEFAULT 0,
    "matchItems" INTEGER NOT NULL DEFAULT 0,
    "recoveredItems" INTEGER NOT NULL DEFAULT 0,
    "errorItems" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "startedBy" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "PaymentReconciliationItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "orderId" TEXT,
    "merchantOrderNo" TEXT NOT NULL,
    "providerTradeNo" TEXT,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "result" TEXT NOT NULL,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "detail" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PaymentReconciliationItem_runId_fkey" FOREIGN KEY ("runId") REFERENCES "PaymentReconciliationRun" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TemplateCategory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "TemplateGroup" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "categoryId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TemplateGroup_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "TemplateCategory" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Prompt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL DEFAULT '',
    "content" TEXT NOT NULL,
    "negativePrompt" TEXT NOT NULL DEFAULT '',
    "modality" TEXT NOT NULL DEFAULT 'image',
    "tags" TEXT NOT NULL DEFAULT '[]',
    "images" TEXT NOT NULL DEFAULT '[]',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "TemplateItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "groupId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "tags" TEXT NOT NULL DEFAULT '[]',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TemplateItem_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "TemplateGroup" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StorageConfig" (
    "backend" TEXT NOT NULL PRIMARY KEY,
    "configCipher" TEXT NOT NULL DEFAULT '',
    "configDigest" TEXT NOT NULL DEFAULT '',
    "updatedBy" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_inviteCode_key" ON "User"("inviteCode");

-- CreateIndex
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX "User_status_idx" ON "User"("status");

-- CreateIndex
CREATE INDEX "OAuthIdentity_userId_idx" ON "OAuthIdentity"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "OAuthIdentity_provider_subject_key" ON "OAuthIdentity"("provider", "subject");

-- CreateIndex
CREATE UNIQUE INDEX "OAuthChallenge_tokenHash_key" ON "OAuthChallenge"("tokenHash");

-- CreateIndex
CREATE INDEX "OAuthChallenge_kind_expiresAt_idx" ON "OAuthChallenge"("kind", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "AdminRole_code_key" ON "AdminRole"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Product_sku_key" ON "Product"("sku");

-- CreateIndex
CREATE INDEX "Product_status_sortOrder_idx" ON "Product"("status", "sortOrder");

-- CreateIndex
CREATE INDEX "Product_status_kind_sortOrder_idx" ON "Product"("status", "kind", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "Order_orderNo_key" ON "Order"("orderNo");

-- CreateIndex
CREATE UNIQUE INDEX "Order_providerTradeNo_key" ON "Order"("providerTradeNo");

-- CreateIndex
CREATE INDEX "Order_membershipPlanId_idx" ON "Order"("membershipPlanId");

-- CreateIndex
CREATE INDEX "Order_userId_status_idx" ON "Order"("userId", "status");

-- CreateIndex
CREATE INDEX "Order_userId_createdAt_idx" ON "Order"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Order_status_createdAt_idx" ON "Order"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Order_createdAt_idx" ON "Order"("createdAt");

-- CreateIndex
CREATE INDEX "Order_couponId_idx" ON "Order"("couponId");

-- CreateIndex
CREATE INDEX "Order_campaignId_idx" ON "Order"("campaignId");

-- CreateIndex
CREATE INDEX "Order_channel_status_createdAt_idx" ON "Order"("channel", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Order_channel_providerPaidAt_idx" ON "Order"("channel", "providerPaidAt");

-- CreateIndex
CREATE INDEX "Order_channel_paidAt_idx" ON "Order"("channel", "paidAt");

-- CreateIndex
CREATE INDEX "Order_status_paidAt_idx" ON "Order"("status", "paidAt");

-- CreateIndex
CREATE INDEX "Order_providerPaidAt_idx" ON "Order"("providerPaidAt");

-- CreateIndex
CREATE INDEX "Order_status_expiresAt_idx" ON "Order"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "Order_providerConfigId_idx" ON "Order"("providerConfigId");

-- CreateIndex
CREATE INDEX "Order_providerInstanceId_idx" ON "Order"("providerInstanceId");

-- CreateIndex
CREATE INDEX "Order_paidAt_idx" ON "Order"("paidAt");

-- CreateIndex
CREATE INDEX "Order_closedAt_idx" ON "Order"("closedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Order_userId_idempotencyKey_key" ON "Order"("userId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "OrderCancelEvent_orderId_key" ON "OrderCancelEvent"("orderId");

-- CreateIndex
CREATE INDEX "OrderCancelEvent_userId_status_windowStart_idx" ON "OrderCancelEvent"("userId", "status", "windowStart");

-- CreateIndex
CREATE INDEX "OrderCancelEvent_userId_status_reservedAt_idx" ON "OrderCancelEvent"("userId", "status", "reservedAt");

-- CreateIndex
CREATE INDEX "OrderItem_orderId_idx" ON "OrderItem"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_payTransactionId_key" ON "Payment"("payTransactionId");

-- CreateIndex
CREATE INDEX "Payment_orderId_idx" ON "Payment"("orderId");

-- CreateIndex
CREATE INDEX "Payment_status_createdAt_idx" ON "Payment"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Payment_userId_idx" ON "Payment"("userId");

-- CreateIndex
CREATE INDEX "Payment_orderId_status_idx" ON "Payment"("orderId", "status");

-- CreateIndex
CREATE INDEX "Payment_providerInstanceId_idx" ON "Payment"("providerInstanceId");

-- CreateIndex
CREATE INDEX "Refund_orderId_idx" ON "Refund"("orderId");

-- CreateIndex
CREATE INDEX "Refund_createdAt_idx" ON "Refund"("createdAt");

-- CreateIndex
CREATE INDEX "CreditLot_userId_expireAt_idx" ON "CreditLot"("userId", "expireAt");

-- CreateIndex
CREATE INDEX "CreditLot_expireAt_idx" ON "CreditLot"("expireAt");

-- CreateIndex
CREATE INDEX "CreditLot_orderId_idx" ON "CreditLot"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "CreditLedger_idempotencyKey_key" ON "CreditLedger"("idempotencyKey");

-- CreateIndex
CREATE INDEX "CreditLedger_userId_createdAt_idx" ON "CreditLedger"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "CreditLedger_type_idx" ON "CreditLedger"("type");

-- CreateIndex
CREATE INDEX "CreditLedger_orderId_idx" ON "CreditLedger"("orderId");

-- CreateIndex
CREATE INDEX "CreditLedger_taskId_idx" ON "CreditLedger"("taskId");

-- CreateIndex
CREATE UNIQUE INDEX "MembershipPlan_code_key" ON "MembershipPlan"("code");

-- CreateIndex
CREATE INDEX "MembershipPlan_status_sortOrder_idx" ON "MembershipPlan"("status", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_orderId_key" ON "Membership"("orderId");

-- CreateIndex
CREATE INDEX "Membership_userId_status_idx" ON "Membership"("userId", "status");

-- CreateIndex
CREATE INDEX "Membership_status_expiresAt_idx" ON "Membership"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "Membership_nextCreditAt_idx" ON "Membership"("nextCreditAt");

-- CreateIndex
CREATE UNIQUE INDEX "MembershipUsage_orderId_key" ON "MembershipUsage"("orderId");

-- CreateIndex
CREATE INDEX "MembershipUsage_userId_createdAt_idx" ON "MembershipUsage"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BackupRecord_filename_key" ON "BackupRecord"("filename");

-- CreateIndex
CREATE INDEX "BackupRecord_status_idx" ON "BackupRecord"("status");

-- CreateIndex
CREATE INDEX "BackupRecord_verified_idx" ON "BackupRecord"("verified");

-- CreateIndex
CREATE INDEX "BackupRecord_createdAt_idx" ON "BackupRecord"("createdAt");

-- CreateIndex
CREATE INDEX "CleanupLog_target_idx" ON "CleanupLog"("target");

-- CreateIndex
CREATE INDEX "CleanupLog_createdAt_idx" ON "CleanupLog"("createdAt");

-- CreateIndex
CREATE INDEX "Project_ownerId_deletedAt_idx" ON "Project"("ownerId", "deletedAt");

-- CreateIndex
CREATE INDEX "Project_deletedAt_idx" ON "Project"("deletedAt");

-- CreateIndex
CREATE INDEX "Asset_projectId_idx" ON "Asset"("projectId");

-- CreateIndex
CREATE INDEX "Asset_ownerId_idx" ON "Asset"("ownerId");

-- CreateIndex
CREATE INDEX "Asset_status_idx" ON "Asset"("status");

-- CreateIndex
CREATE INDEX "Asset_ownerId_status_createdAt_idx" ON "Asset"("ownerId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Asset_storageBackend_idx" ON "Asset"("storageBackend");

-- CreateIndex
CREATE INDEX "Asset_capability_idx" ON "Asset"("capability");

-- CreateIndex
CREATE INDEX "Asset_createdAt_idx" ON "Asset"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Asset_storageBackend_storageKey_key" ON "Asset"("storageBackend", "storageKey");

-- CreateIndex
CREATE UNIQUE INDEX "GenerationTask_outputAssetId_key" ON "GenerationTask"("outputAssetId");

-- CreateIndex
CREATE UNIQUE INDEX "GenerationTask_retryKey_key" ON "GenerationTask"("retryKey");

-- CreateIndex
CREATE INDEX "GenerationTask_projectId_idx" ON "GenerationTask"("projectId");

-- CreateIndex
CREATE INDEX "GenerationTask_ownerId_idx" ON "GenerationTask"("ownerId");

-- CreateIndex
CREATE INDEX "GenerationTask_status_idx" ON "GenerationTask"("status");

-- CreateIndex
CREATE INDEX "GenerationTask_capability_idx" ON "GenerationTask"("capability");

-- CreateIndex
CREATE INDEX "GenerationTask_createdAt_idx" ON "GenerationTask"("createdAt");

-- CreateIndex
CREATE INDEX "GenerationTask_status_createdAt_idx" ON "GenerationTask"("status", "createdAt");

-- CreateIndex
CREATE INDEX "GenerationTask_ownerId_createdAt_idx" ON "GenerationTask"("ownerId", "createdAt");

-- CreateIndex
CREATE INDEX "GenerationTask_status_heartbeatAt_idx" ON "GenerationTask"("status", "heartbeatAt");

-- CreateIndex
CREATE INDEX "GenerationTask_status_nextPollAt_idx" ON "GenerationTask"("status", "nextPollAt");

-- CreateIndex
CREATE INDEX "GenerationTask_status_leaseUntil_idx" ON "GenerationTask"("status", "leaseUntil");

-- CreateIndex
CREATE INDEX "GenerationTask_billingOrderId_idx" ON "GenerationTask"("billingOrderId");

-- CreateIndex
CREATE INDEX "GenerationTask_parentTaskId_idx" ON "GenerationTask"("parentTaskId");

-- CreateIndex
CREATE UNIQUE INDEX "GenerationTask_ownerId_idempotencyKey_key" ON "GenerationTask"("ownerId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "Coupon_code_key" ON "Coupon"("code");

-- CreateIndex
CREATE INDEX "Coupon_status_validFrom_validTo_idx" ON "Coupon"("status", "validFrom", "validTo");

-- CreateIndex
CREATE INDEX "Coupon_type_idx" ON "Coupon"("type");

-- CreateIndex
CREATE INDEX "Campaign_status_startAt_endAt_idx" ON "Campaign"("status", "startAt", "endAt");

-- CreateIndex
CREATE INDEX "Campaign_type_idx" ON "Campaign"("type");

-- CreateIndex
CREATE UNIQUE INDEX "InviteRelation_inviteeId_key" ON "InviteRelation"("inviteeId");

-- CreateIndex
CREATE INDEX "InviteRelation_inviterId_rewardStatus_idx" ON "InviteRelation"("inviterId", "rewardStatus");

-- CreateIndex
CREATE INDEX "InviteRelation_inviteCode_idx" ON "InviteRelation"("inviteCode");

-- CreateIndex
CREATE INDEX "InviteRelation_rewardStatus_idx" ON "InviteRelation"("rewardStatus");

-- CreateIndex
CREATE INDEX "CheckinRecord_userId_createdAt_idx" ON "CheckinRecord"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CheckinRecord_userId_day_key" ON "CheckinRecord"("userId", "day");

-- CreateIndex
CREATE UNIQUE INDEX "AccountToken_tokenHash_key" ON "AccountToken"("tokenHash");

-- CreateIndex
CREATE INDEX "AccountToken_userId_type_idx" ON "AccountToken"("userId", "type");

-- CreateIndex
CREATE INDEX "AccountToken_phone_type_idx" ON "AccountToken"("phone", "type");

-- CreateIndex
CREATE INDEX "AccountToken_email_type_idx" ON "AccountToken"("email", "type");

-- CreateIndex
CREATE INDEX "AccountToken_expiresAt_idx" ON "AccountToken"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentExceptionCase_fingerprint_key" ON "PaymentExceptionCase"("fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentExceptionCase_refundId_key" ON "PaymentExceptionCase"("refundId");

-- CreateIndex
CREATE INDEX "PaymentExceptionCase_status_priority_slaDueAt_idx" ON "PaymentExceptionCase"("status", "priority", "slaDueAt");

-- CreateIndex
CREATE INDEX "PaymentExceptionCase_providerId_merchantOrderNo_idx" ON "PaymentExceptionCase"("providerId", "merchantOrderNo");

-- CreateIndex
CREATE INDEX "PaymentExceptionCase_orderId_idx" ON "PaymentExceptionCase"("orderId");

-- CreateIndex
CREATE INDEX "PaymentAutoReconcileState_status_nextAttemptAt_idx" ON "PaymentAutoReconcileState"("status", "nextAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentAutoReconcileState_providerId_providerInstanceId_billDate_key" ON "PaymentAutoReconcileState"("providerId", "providerInstanceId", "billDate");

-- CreateIndex
CREATE INDEX "LoginLog_userId_createdAt_idx" ON "LoginLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "LoginLog_email_createdAt_idx" ON "LoginLog"("email", "createdAt");

-- CreateIndex
CREATE INDEX "LoginLog_createdAt_idx" ON "LoginLog"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LoginSession_tokenHash_key" ON "LoginSession"("tokenHash");

-- CreateIndex
CREATE INDEX "LoginSession_status_expiresAt_idx" ON "LoginSession"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "LoginSession_userId_idx" ON "LoginSession"("userId");

-- CreateIndex
CREATE INDEX "LoginSession_expiresAt_idx" ON "LoginSession"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_invoiceNo_key" ON "Invoice"("invoiceNo");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_activeOrderId_key" ON "Invoice"("activeOrderId");

-- CreateIndex
CREATE INDEX "Invoice_userId_createdAt_idx" ON "Invoice"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Invoice_status_createdAt_idx" ON "Invoice"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Invoice_orderId_createdAt_idx" ON "Invoice"("orderId", "createdAt");

-- CreateIndex
CREATE INDEX "ReconciliationBatch_channel_billDate_idx" ON "ReconciliationBatch"("channel", "billDate");

-- CreateIndex
CREATE INDEX "ReconciliationBatch_createdAt_idx" ON "ReconciliationBatch"("createdAt");

-- CreateIndex
CREATE INDEX "ReconciliationItem_diffType_status_idx" ON "ReconciliationItem"("diffType", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ReconciliationItem_batchId_tradeNo_key" ON "ReconciliationItem"("batchId", "tradeNo");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_createdAt_idx" ON "Notification"("createdAt");

-- CreateIndex
CREATE INDEX "MessageTemplate_channel_enabled_idx" ON "MessageTemplate"("channel", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "MessageTemplate_code_channel_key" ON "MessageTemplate"("code", "channel");

-- CreateIndex
CREATE INDEX "CapabilityControl_enabled_idx" ON "CapabilityControl"("enabled");

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_ticketNo_key" ON "Ticket"("ticketNo");

-- CreateIndex
CREATE INDEX "Ticket_userId_createdAt_idx" ON "Ticket"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Ticket_status_createdAt_idx" ON "Ticket"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Ticket_assigneeId_idx" ON "Ticket"("assigneeId");

-- CreateIndex
CREATE INDEX "Ticket_type_createdAt_idx" ON "Ticket"("type", "createdAt");

-- CreateIndex
CREATE INDEX "TicketReply_ticketId_createdAt_idx" ON "TicketReply"("ticketId", "createdAt");

-- CreateIndex
CREATE INDEX "ModelChannel_scope_enabled_idx" ON "ModelChannel"("scope", "enabled");

-- CreateIndex
CREATE INDEX "ModelChannel_deletedAt_idx" ON "ModelChannel"("deletedAt");

-- CreateIndex
CREATE INDEX "ModelChannel_catalogProviderId_idx" ON "ModelChannel"("catalogProviderId");

-- CreateIndex
CREATE INDEX "ModelChannel_sortOrder_idx" ON "ModelChannel"("sortOrder");

-- CreateIndex
CREATE INDEX "ChannelModel_channelId_enabled_idx" ON "ChannelModel"("channelId", "enabled");

-- CreateIndex
CREATE INDEX "ChannelModel_capability_protocol_idx" ON "ChannelModel"("capability", "protocol");

-- CreateIndex
CREATE INDEX "ChannelModel_deletedAt_idx" ON "ChannelModel"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelModel_channelId_activeKey_key" ON "ChannelModel"("channelId", "activeKey");

-- CreateIndex
CREATE INDEX "ChannelModelPriceTier_channelModelId_enabled_idx" ON "ChannelModelPriceTier"("channelModelId", "enabled");

-- CreateIndex
CREATE INDEX "ChannelModelPriceTier_deletedAt_idx" ON "ChannelModelPriceTier"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelModelPriceTier_channelModelId_activeKey_key" ON "ChannelModelPriceTier"("channelModelId", "activeKey");

-- CreateIndex
CREATE INDEX "CapabilityModelBinding_capabilityId_enabled_idx" ON "CapabilityModelBinding"("capabilityId", "enabled");

-- CreateIndex
CREATE INDEX "CapabilityModelBinding_channelModelId_idx" ON "CapabilityModelBinding"("channelModelId");

-- CreateIndex
CREATE UNIQUE INDEX "CapabilityModelBinding_capabilityId_channelModelId_key" ON "CapabilityModelBinding"("capabilityId", "channelModelId");

-- CreateIndex
CREATE INDEX "RouteAttempt_taskId_idx" ON "RouteAttempt"("taskId");

-- CreateIndex
CREATE INDEX "RouteAttempt_channelModelId_idx" ON "RouteAttempt"("channelModelId");

-- CreateIndex
CREATE INDEX "RouteAttempt_status_idx" ON "RouteAttempt"("status");

-- CreateIndex
CREATE INDEX "RouteAttempt_routeRun_idx" ON "RouteAttempt"("routeRun");

-- CreateIndex
CREATE INDEX "RouteAttempt_dispatchState_idx" ON "RouteAttempt"("dispatchState");

-- CreateIndex
CREATE INDEX "RouteAttempt_providerRequestId_idx" ON "RouteAttempt"("providerRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "RouteAttempt_taskId_routeRun_attemptNumber_key" ON "RouteAttempt"("taskId", "routeRun", "attemptNumber");

-- CreateIndex
CREATE INDEX "UserGroup_sortOrder_idx" ON "UserGroup"("sortOrder");

-- CreateIndex
CREATE INDEX "UserGroup_deletedAt_idx" ON "UserGroup"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "UserGroup_activeKey_key" ON "UserGroup"("activeKey");

-- CreateIndex
CREATE INDEX "UserGroupChannel_channelId_idx" ON "UserGroupChannel"("channelId");

-- CreateIndex
CREATE INDEX "BillingOrder_userId_status_idx" ON "BillingOrder"("userId", "status");

-- CreateIndex
CREATE INDEX "BillingOrder_taskId_idx" ON "BillingOrder"("taskId");

-- CreateIndex
CREATE INDEX "BillingOrder_channelId_idx" ON "BillingOrder"("channelId");

-- CreateIndex
CREATE INDEX "BillingOrder_channelModelId_idx" ON "BillingOrder"("channelModelId");

-- CreateIndex
CREATE INDEX "BillingOrder_status_createdAt_idx" ON "BillingOrder"("status", "createdAt");

-- CreateIndex
CREATE INDEX "BillingOrder_reviewBatchId_idx" ON "BillingOrder"("reviewBatchId");

-- CreateIndex
CREATE INDEX "BillingOrder_model_idx" ON "BillingOrder"("model");

-- CreateIndex
CREATE INDEX "BillingOrder_capability_idx" ON "BillingOrder"("capability");

-- CreateIndex
CREATE INDEX "BillingOrder_scene_idx" ON "BillingOrder"("scene");

-- CreateIndex
CREATE UNIQUE INDEX "BillingOrder_userId_idempotencyKey_key" ON "BillingOrder"("userId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "CreditLedgerEntry_referenceKey_key" ON "CreditLedgerEntry"("referenceKey");

-- CreateIndex
CREATE INDEX "CreditLedgerEntry_userId_createdAt_idx" ON "CreditLedgerEntry"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "CreditLedgerEntry_userId_type_idx" ON "CreditLedgerEntry"("userId", "type");

-- CreateIndex
CREATE INDEX "CreditLedgerEntry_userId_businessType_idx" ON "CreditLedgerEntry"("userId", "businessType");

-- CreateIndex
CREATE INDEX "CreditLedgerEntry_billingOrderId_idx" ON "CreditLedgerEntry"("billingOrderId");

-- CreateIndex
CREATE INDEX "CreditLedgerEntry_lotId_idx" ON "CreditLedgerEntry"("lotId");

-- CreateIndex
CREATE INDEX "CreditReservationItem_lotId_idx" ON "CreditReservationItem"("lotId");

-- CreateIndex
CREATE INDEX "ApiCallLog_userId_createdAt_idx" ON "ApiCallLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ApiCallLog_channelId_createdAt_idx" ON "ApiCallLog"("channelId", "createdAt");

-- CreateIndex
CREATE INDEX "ApiCallLog_channelModelId_createdAt_idx" ON "ApiCallLog"("channelModelId", "createdAt");

-- CreateIndex
CREATE INDEX "ApiCallLog_model_createdAt_idx" ON "ApiCallLog"("model", "createdAt");

-- CreateIndex
CREATE INDEX "ApiCallLog_taskId_idx" ON "ApiCallLog"("taskId");

-- CreateIndex
CREATE INDEX "ApiCallLog_status_createdAt_idx" ON "ApiCallLog"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ApiCallLog_source_operation_createdAt_idx" ON "ApiCallLog"("source", "operation", "createdAt");

-- CreateIndex
CREATE INDEX "ApiCallLog_createdAt_idx" ON "ApiCallLog"("createdAt");

-- CreateIndex
CREATE INDEX "ApiCallLog_requestKind_status_createdAt_idx" ON "ApiCallLog"("requestKind", "status", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentProviderConfig_providerId_instanceId_sortOrder_idx" ON "PaymentProviderConfig"("providerId", "instanceId", "sortOrder");

-- CreateIndex
CREATE INDEX "PaymentProviderConfig_providerId_createdAt_idx" ON "PaymentProviderConfig"("providerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentProviderConfig_providerId_instanceId_version_key" ON "PaymentProviderConfig"("providerId", "instanceId", "version");

-- CreateIndex
CREATE INDEX "PaymentNotification_status_nextAttemptAt_idx" ON "PaymentNotification"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "PaymentNotification_merchantOrderNo_idx" ON "PaymentNotification"("merchantOrderNo");

-- CreateIndex
CREATE INDEX "PaymentNotification_orderId_idx" ON "PaymentNotification"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentNotification_providerId_providerEventId_key" ON "PaymentNotification"("providerId", "providerEventId");

-- CreateIndex
CREATE INDEX "PaymentReconciliationRun_providerId_providerInstanceId_billDate_status_idx" ON "PaymentReconciliationRun"("providerId", "providerInstanceId", "billDate", "status");

-- CreateIndex
CREATE INDEX "PaymentReconciliationRun_status_createdAt_idx" ON "PaymentReconciliationRun"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentReconciliationRun_providerId_providerInstanceId_billDate_attempt_key" ON "PaymentReconciliationRun"("providerId", "providerInstanceId", "billDate", "attempt");

-- CreateIndex
CREATE INDEX "PaymentReconciliationItem_result_idx" ON "PaymentReconciliationItem"("result");

-- CreateIndex
CREATE INDEX "PaymentReconciliationItem_providerId_merchantOrderNo_idx" ON "PaymentReconciliationItem"("providerId", "merchantOrderNo");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentReconciliationItem_runId_merchantOrderNo_providerTradeNo_key" ON "PaymentReconciliationItem"("runId", "merchantOrderNo", "providerTradeNo");

-- CreateIndex
CREATE UNIQUE INDEX "TemplateCategory_slug_key" ON "TemplateCategory"("slug");

-- CreateIndex
CREATE INDEX "TemplateCategory_enabled_sortOrder_idx" ON "TemplateCategory"("enabled", "sortOrder");

-- CreateIndex
CREATE INDEX "TemplateGroup_categoryId_enabled_sortOrder_idx" ON "TemplateGroup"("categoryId", "enabled", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "TemplateGroup_categoryId_slug_key" ON "TemplateGroup"("categoryId", "slug");

-- CreateIndex
CREATE INDEX "Prompt_enabled_modality_sortOrder_idx" ON "Prompt"("enabled", "modality", "sortOrder");

-- CreateIndex
CREATE INDEX "Prompt_category_idx" ON "Prompt"("category");

-- CreateIndex
CREATE INDEX "TemplateItem_groupId_enabled_sortOrder_idx" ON "TemplateItem"("groupId", "enabled", "sortOrder");
