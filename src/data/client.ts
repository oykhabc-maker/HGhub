import { invoke } from "@tauri-apps/api/core";

/** 前端只认识领域命令；上游接口细节全部留在 Shell / Adapter 层。 */
export type DataCommand = { cmd: string } & Record<string, unknown>;

/** 所有业务数据只走这一个入口。 */
export function dataCall<T>(command: DataCommand): Promise<T> {
  return invoke<T>("data_call", { command });
}
