# Task ID: 3

**Title:** 统一运行期线路配置源，删除合成与固化路径

**Status:** pending

**Dependencies:** 1, 2

**Priority:** high

**Description:** ModelChannel 成为唯一线路事实源；删除 ChannelScheduler 合成通道、ChannelRepository.synthesize/materialize、HTTP materialize 端点；ChannelSnapshot.source 只保留 channels|none；无线路时能力 unavailable 且生成返回 42204。

**Details:**

落点：channel-scheduler.ts、channel-repository.ts、model-channel.service.ts/controller.ts、capability-availability.service.ts、generate.service.ts、frontend/src/lib/api.ts。全停用时 source 仍为 channels，绝不回落旧配置。前端删除 legacy 文案与固化入口。

**Test Strategy:**

表空时 source=none；全停用时 source=channels 且 enabledCount=0；两种情况下生成均 42204 并退款；不存在 synthetic: 通道；materialize 路由 404。
