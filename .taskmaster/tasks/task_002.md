# Task ID: 2

**Title:** 建立协议注册表与启动期完整性校验

**Status:** pending

**Dependencies:** 1

**Priority:** high

**Description:** 新增按 (modality, protocol) 的协议注册表，合并 ProtocolSpec、VideoProtocolSpec 与 provider-factory 的声明；启动期 assertProtocolIntegrity，新增 verify-protocol-matrix 脚本。

**Details:**

落点：backend/src/providers/protocols/protocol.registry.ts、protocol.spec.ts、provider-factory.ts、backend/scripts/verify-protocol-matrix.ts。注册项需含 spec、createProvider、support（后台下拉与保存校验用）。未知协议显式抛错。校验：每个声明有 factory、每个 factory 有声明、厂商目录声明的协议存在、后台下拉数据源一致。

**Test Strategy:**

单测未知协议抛错；删除一条 factory 时启动失败并指出协议名；verify-protocol-matrix 通过；现有 image/text/video 协议全部登记。
