# 文件与执行

工作区限根文件、写入租约与撤销、本机 Shell supervisor、Playwright 适配与执行开关已有实现。P4 仍在实施：组件安装入口与持久操作、冻结浏览器入口及正常工具运行时尚未闭环，位置和关闭条件见[收尾清单](first-delivery-remaining.md)。机制见[架构说明](../architecture.md#执行环境与限制)与[代码地图](../code-map.md#文件与交付)。

## 留给后续阶段

- **P10**：离线浏览器／Embedding／OCR 组件包与同一校验路径。
- **P11**：Windows 原生句柄 IO、reparse-point、Job Object、PowerShell；重复 Mac 上的文件与进程边界检查。
- **已知遗留（非阻塞首个交付）**：覆盖发布尚未用 `renamex_np` 做原子替换；外部进程写入者租约的用户确认释放入口可在正式发布前补强。
