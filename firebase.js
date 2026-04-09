import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js';
import { getDatabase, ref, push, onValue, remove, update, set, get, child, limitToLast, query, onDisconnect, runTransaction, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';
import { firebaseConfig } from './firebase-config.js';

const _app = initializeApp(firebaseConfig);
export const database     = getDatabase(_app);
export const auth         = getAuth(_app);
export const googleProvider = new GoogleAuthProvider();

// Re-export Firebase SDK functions so other modules can import from one place
export { ref, push, onValue, remove, update, set, get, child, limitToLast, query, onDisconnect, runTransaction, serverTimestamp, onAuthStateChanged, signInWithPopup, signOut };

// Named Firebase database refs
export const postsRef             = ref(database, 'posts');
export const chatRef              = ref(database, 'chat');
export const boardsRef            = ref(database, 'boards');
export const boardItemsRef        = ref(database, 'board_items');
export const boardDeleteRequestsRef = ref(database, 'board_delete_requests');
export const lettersRef           = ref(database, 'letters');
export const linkMetaRef          = ref(database, 'linkMeta');
export const recycleBinRef        = ref(database, 'recycleBin');
export const categoriesRef        = ref(database, 'categories');
export const wishlistBoardsRef    = ref(database, 'wishlistBoards');
export const wishlistItemsRef     = ref(database, 'wishlistItems');
export const foodDiaryRef         = ref(database, 'foodDiary');
export const painJournalRef       = ref(database, 'painJournal');
export const painPatternNotesRef  = ref(database, 'painPatternNotes');
export const moodJournalRef       = ref(database, 'moodJournal');
export const shoppingListsRef     = ref(database, 'shoppingLists');
