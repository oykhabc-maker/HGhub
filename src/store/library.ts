import { useStore } from "./index";

/** Library 切片：收藏、喜欢、观看历史、关注与搜索历史。 */
export function useLibraryStore() {
  const s = useStore();
  return {
    likes: s.likes, favs: s.favs, history: s.history, follows: s.follows,
    isLiked: s.isLiked, isFav: s.isFav,
    toggleLikeLocal: s.toggleLikeLocal, toggleFavLocal: s.toggleFavLocal, toggleFollowLocal: s.toggleFollowLocal,
    addHistory: s.addHistory, clearHistory: s.clearHistory,
    searchHist: s.searchHist, addSearch: s.addSearch, clearSearchHist: s.clearSearchHist,
  };
}
