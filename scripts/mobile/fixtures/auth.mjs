// This module is never bundled by the real mobile build.
const identity={uid:'audit-user',email:'fixture0@example.invalid',getIdToken:async()=> 'FICTIONAL-AUDIT-TOKEN'};
let current=identity;
export const getAuth=()=>({get currentUser(){return current;}});
export function onAuthStateChanged(a,cb){let alive=true;queueMicrotask(()=>{if(alive)cb(current);});return()=>{alive=false;};}
export async function signOut(){current=null;}
export async function signInWithEmailAndPassword(){current=identity;return {user:identity};}
export async function createUserWithEmailAndPassword(){throw Error('Account creation is disabled in this fictional audit.');}
export const fetchSignInMethodsForEmail=async()=>[];
