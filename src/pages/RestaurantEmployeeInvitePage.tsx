import { FormEvent, useEffect, useState } from 'react';
import { supabase } from '../services/supabaseClient';
import { getPasswordPolicyError, isCommonPassword, PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH } from '../utils/passwordPolicy';

function appBaseUrl() { return `${window.location.origin}${import.meta.env.BASE_URL}`; }
function params() {
  const search = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  return {
    tokenHash: search.get('token_hash') ?? hash.get('token_hash') ?? '',
    tokenType: search.get('type') ?? hash.get('type') ?? '',
    errorCode: search.get('error_code') ?? hash.get('error_code') ?? '',
    errorDescription: search.get('error_description') ?? hash.get('error_description') ?? '',
  };
}

export function RestaurantEmployeeInvitePage() {
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const [email,setEmail]=useState('');
  const [name,setName]=useState('');
  const [role,setRole]=useState('');
  const [tokenHash,setTokenHash]=useState('');
  const [tokenType,setTokenType]=useState<'invite'|'recovery'>('invite');
  const [password,setPassword]=useState('');
  const [confirmPassword,setConfirmPassword]=useState('');
  const [showPassword,setShowPassword]=useState(false);
  const [showConfirmPassword,setShowConfirmPassword]=useState(false);
  const [error,setError]=useState('');
  const [success,setSuccess]=useState(false);

  useEffect(()=>{let mounted=true;async function load(){if(!supabase){if(mounted){setError('Supabase is not configured.');setLoading(false)}return}
    const p=params();
    if(p.errorCode||p.errorDescription){if(mounted){setError(p.errorDescription||'This invitation is invalid or has expired.');setLoading(false)}return}
    if(p.tokenHash&&(p.tokenType==='invite'||p.tokenType==='recovery')){setTokenHash(p.tokenHash);setTokenType(p.tokenType as 'invite'|'recovery');setLoading(false);return}
    const hash=new URLSearchParams(window.location.hash.replace(/^#/,''));
    const access=hash.get('access_token'),refresh=hash.get('refresh_token'),type=hash.get('type');
    if((type==='invite'||type==='recovery')&&access&&refresh){setTokenType(type as 'invite'|'recovery');const {error}=await supabase.auth.setSession({access_token:access,refresh_token:refresh});if(error){if(mounted){setError(error.message);setLoading(false)}return}window.history.replaceState({},document.title,window.location.pathname+window.location.search)}
    const {data,error:sessionError}=await supabase.auth.getSession();if(!mounted)return;if(sessionError||!data.session?.user){setError(sessionError?.message||'This invitation is missing or has expired.');setLoading(false);return}
    const user=data.session.user;setEmail(user.email??'');setName(String(user.user_metadata?.name??''));setRole(String(user.user_metadata?.role??''));setLoading(false);
  }void load();return()=>{mounted=false}},[]);

  async function accept(){if(!supabase||!tokenHash)return;setSaving(true);setError('');const {data,error:verifyError}=await supabase.auth.verifyOtp({token_hash:tokenHash,type:tokenType});if(verifyError){setError(verifyError.message);setSaving(false);return}const user=data.user;if(!user){setError('The invitation was accepted but no account was returned.');setSaving(false);return}setEmail(user.email??'');setName(String(user.user_metadata?.name??''));setRole(String(user.user_metadata?.role??''));setTokenHash('');window.history.replaceState({},document.title,appBaseUrl()+'?employee-invite=1');setSaving(false)}
  async function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();if(!supabase)return;setError('');const policyError=getPasswordPolicyError(password);if(policyError){setError(policyError);return}if(password!==confirmPassword){setError('Passwords do not match.');return}setSaving(true);const {error:updateError}=await supabase.auth.updateUser({password});setSaving(false);if(updateError){setError(updateError.message);return}setSuccess(true)}
  if(loading)return <section className="restaurant-owner-auth-loading"><p>Preparing your invitation…</p></section>;
  return <section className="restaurant-employee-invite-page"><div className="restaurant-employee-invite-card"><p className="eyebrow">Employee invitation</p><h1>{success?'Your account is ready.':error?'Invitation link problem':`Welcome${name?`, ${name}`:''}.`}</h1>
    {error?<><p className="restaurant-employee-invite-error" role="alert">{error}</p><p>Ask the restaurant owner to send you a new invitation.</p><a className="button button-primary" href={appBaseUrl()}>Back to restaurant</a></>:
    success?<><p>Your password has been set for <strong>{email}</strong>.</p><p>You can now sign in with your employee account.</p><a className="button button-primary" href={appBaseUrl()+'#account'}>Continue to Sign in</a></>:
    tokenHash?<><p>{tokenType==='recovery'?'Your password setup link is ready. Continue to set your employee password.':'Your employee invitation is ready. Accept it to continue.'}</p><button className="button button-primary" type="button" onClick={()=>void accept()} disabled={saving}>{saving?'Accepting…':'Accept Invitation'}</button></>:
    <form onSubmit={(e)=>void submit(e)}><p>Set a password to finish creating your {role||'employee'} account.</p><label>Email<input type="email" value={email} readOnly /></label><label className="customer-signup-password-field">Password<span className="customer-password-input-wrap"><input type={showPassword?'text':'password'} value={password} onChange={e=>setPassword(e.target.value)} minLength={PASSWORD_MIN_LENGTH} maxLength={PASSWORD_MAX_LENGTH} autoComplete="new-password" required disabled={saving} /><button className="customer-password-visibility-button" type="button" onClick={()=>setShowPassword(v=>!v)} aria-label={showPassword?'Hide password':'Show password'} aria-pressed={showPassword} disabled={saving}>{showPassword?<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18M10.6 10.6a2 2 0 002.8 2.8M9.9 5.2A10.8 10.8 0 0112 5c5.2 0 8.8 4.7 9.5 6-.3.6-1.4 2.2-3.4 3.7M6.2 6.2C3.9 7.6 2.6 9.7 2.5 11c.7 1.3 4.3 6 9.5 6 1 0 1.9-.2 2.7-.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>:<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="1.8"/></svg>}</button></span></label><label className="customer-signup-password-field">Confirm password<span className="customer-password-input-wrap"><input type={showConfirmPassword?'text':'password'} value={confirmPassword} onChange={e=>setConfirmPassword(e.target.value)} minLength={PASSWORD_MIN_LENGTH} maxLength={PASSWORD_MAX_LENGTH} autoComplete="new-password" required disabled={saving} /><button className="customer-password-visibility-button" type="button" onClick={()=>setShowConfirmPassword(v=>!v)} aria-label={showConfirmPassword?'Hide confirmation password':'Show confirmation password'} aria-pressed={showConfirmPassword} disabled={saving}>{showConfirmPassword?<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18M10.6 10.6a2 2 0 002.8 2.8M9.9 5.2A10.8 10.8 0 0112 5c5.2 0 8.8 4.7 9.5 6-.3.6-1.4 2.2-3.4 3.7M6.2 6.2C3.9 7.6 2.6 9.7 2.5 11c.7 1.3 4.3 6 9.5 6 1 0 1.9-.2 2.7-.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>:<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="1.8"/></svg>}</button></span></label><fieldset className="customer-password-checklist" aria-label="Password requirements">{[{label:'At least 8 characters',met:password.length>=PASSWORD_MIN_LENGTH},{label:'128 characters or fewer',met:password.length>0&&password.length<=PASSWORD_MAX_LENGTH},{label:'Includes a lowercase letter',met:/[a-z]/.test(password)},{label:'Includes an uppercase letter',met:/[A-Z]/.test(password)},{label:'Includes a number',met:/\d/.test(password)},{label:'Includes a symbol',met:/[^A-Za-z0-9]/.test(password)},{label:'Not a common password',met:password.length>0&&!isCommonPassword(password)}].map(rule=><label className={`customer-password-checklist-item${rule.met?' is-met':''}`} key={rule.label}><input type="checkbox" checked={rule.met} readOnly tabIndex={-1} aria-label={rule.label+(rule.met?' met':' not met')} /><span>{rule.label}</span></label>)}{password&&getPasswordPolicyError(password)?<small className="customer-password-policy-error">{getPasswordPolicyError(password)}</small>:null}</fieldset><button className="button button-primary" type="submit" disabled={saving}>{saving?'Saving…':'Set Password'}</button></form>}
  </div></section>;
}
