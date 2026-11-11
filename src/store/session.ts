import { useStore } from "./index";

/** Session 切片：登录用户与会话动作。 */
export function useSessionStore() {
  const s = useStore();
  return { user: s.user, setUser: s.setUser, loginOpen: s.loginOpen, setLoginOpen: s.setLoginOpen, logout: s.logout };
}
