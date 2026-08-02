"use client";

import { useEffect, useState } from "react";
import { useAuth } from "../../providers";
import { apiFetch } from "@/lib/api";
import type { AppUser, Role } from "@/lib/types";
import { Alert, Badge, Spinner } from "@/components/ui";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from "@/components/ui/sheet";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Label } from "@/components/ui/label";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { MoreHorizontal, Plus, Users as UsersIcon, ShieldAlert, KeyRound } from "lucide-react";

export default function UsersPage() {
  const { token, activeTenantId } = useAuth();
  const [users, setUsers] = useState<AppUser[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [userForm, setUserForm] = useState({ email: "", full_name: "", password: "" });
  const [grant, setGrant] = useState({ user_id: "", role_id: "" });

  async function load() {
    if (!token || !activeTenantId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [u, r] = await Promise.all([
        apiFetch<AppUser[]>("/users", { token, tenantId: activeTenantId }),
        apiFetch<Role[]>("/roles", { token, tenantId: activeTenantId }),
      ]);
      setUsers(u);
      setRoles(r);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, activeTenantId]);

  async function createUser(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/users", {
        method: "POST",
        token,
        tenantId: activeTenantId,
        body: {
          email: userForm.email,
          full_name: userForm.full_name || undefined,
          password: userForm.password,
        },
      });
      setSheetOpen(false);
      setUserForm({ email: "", full_name: "", password: "" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create user");
    } finally {
      setBusy(false);
    }
  }

  async function grantMembership(e: React.FormEvent) {
    e.preventDefault();
    if (!grant.user_id || !grant.role_id) return;
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      await apiFetch("/memberships", {
        method: "POST",
        token,
        tenantId: activeTenantId,
        body: { user_id: grant.user_id, role_id: grant.role_id },
      });
      setMsg("Membership granted.");
      setGrant({ user_id: "", role_id: "" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to grant membership");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-900">Users &amp; Roles</h1>
          <p className="text-sm text-slate-500 mt-1">
            Manage users and grant HOA memberships with Role-Based Access Control.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button onClick={() => setSheetOpen(true)} className="gap-2 bg-indigo-600 hover:bg-indigo-700 text-white">
            <Plus className="h-4 w-4" /> New User
          </Button>
        </div>
      </div>

      {error && <Alert kind="error">{error}</Alert>}
      {msg && <Alert kind="success">{msg}</Alert>}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2 shadow-sm border-slate-200 rounded-xl overflow-hidden">
          <CardHeader className="bg-slate-50 border-b border-slate-100">
            <CardTitle className="text-sm font-semibold text-slate-700 flex items-center gap-2">
              <UsersIcon className="h-4 w-4 text-slate-400" /> Active Users
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              {loading ? (
                <div className="flex justify-center p-12"><Spinner /></div>
              ) : (
                <Table>
                  <TableHeader className="bg-slate-50/50">
                    <TableRow>
                      <TableHead className="font-semibold text-slate-600 pl-6">User</TableHead>
                      <TableHead className="font-semibold text-slate-600">Role</TableHead>
                      <TableHead className="font-semibold text-slate-600">Status</TableHead>
                      <TableHead className="font-semibold text-slate-600 text-right pr-6"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {users.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={4} className="h-32 text-center text-slate-500 font-medium">
                          No users found.
                        </TableCell>
                      </TableRow>
                    )}
                    {users.map((u) => (
                      <TableRow key={u.id} className="hover:bg-slate-50 transition-colors group">
                        <TableCell className="pl-6 py-4">
                           <div className="font-semibold text-slate-800">{u.full_name || "—"}</div>
                           <div className="text-sm text-slate-500">{u.email}</div>
                        </TableCell>
                        <TableCell>
                          {u.is_superadmin ? (
                             <Badge tone="O" className="bg-amber-50 text-amber-700 border-amber-200">SUPERADMIN</Badge>
                          ) : (
                             <span className="text-sm text-slate-400">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge tone={u.is_active ? "A" : "L"} className={u.is_active ? "bg-emerald-50 text-emerald-700 border-emerald-200" : ""}>
                            {u.is_active ? "Active" : "Disabled"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right pr-6">
                           <DropdownMenu>
                             <DropdownMenuTrigger asChild>
                               <Button variant="ghost" className="h-8 w-8 p-0 opacity-0 group-hover:opacity-100 transition-opacity">
                                 <span className="sr-only">Open menu</span>
                                 <MoreHorizontal className="h-4 w-4" />
                               </Button>
                             </DropdownMenuTrigger>
                             <DropdownMenuContent align="end" className="w-[160px]">
                               <DropdownMenuLabel>Actions</DropdownMenuLabel>
                               <DropdownMenuItem onClick={() => setGrant({...grant, user_id: u.id})}>
                                 Assign Role
                               </DropdownMenuItem>
                               <DropdownMenuSeparator />
                               <DropdownMenuItem disabled className="text-slate-400">
                                 Edit User
                               </DropdownMenuItem>
                               <DropdownMenuItem disabled className="text-rose-500 font-medium">
                                 {u.is_active ? "Disable User" : "Enable User"}
                               </DropdownMenuItem>
                             </DropdownMenuContent>
                           </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card className="shadow-sm border-slate-200 rounded-xl border-t-4 border-t-indigo-500">
            <CardHeader className="pb-4">
              <CardTitle className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                 <ShieldAlert className="h-4 w-4 text-indigo-500" />
                 Grant Membership
              </CardTitle>
              <CardDescription>Assign HOA roles to existing users.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={grantMembership} className="space-y-4">
                <div className="space-y-2">
                  <Label className="text-sm font-semibold text-slate-700">User</Label>
                  <Select value={grant.user_id} onValueChange={(val) => setGrant({ ...grant, user_id: val })} required>
                    <SelectTrigger className="bg-slate-50 border-slate-200">
                      <SelectValue placeholder="Select user…" />
                    </SelectTrigger>
                    <SelectContent>
                      {users.map((u) => (
                        <SelectItem key={u.id} value={u.id}>{u.email}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="text-sm font-semibold text-slate-700">Role</Label>
                  <Select value={grant.role_id} onValueChange={(val) => setGrant({ ...grant, role_id: val })} required>
                    <SelectTrigger className="bg-slate-50 border-slate-200 font-mono text-sm">
                      <SelectValue placeholder="Select role…" />
                    </SelectTrigger>
                    <SelectContent>
                      {roles.map((r) => (
                        <SelectItem key={r.id} value={r.id} className="font-mono text-sm">{r.code}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button type="submit" className="w-full bg-indigo-600 hover:bg-indigo-700 text-white mt-2" disabled={busy || !grant.user_id || !grant.role_id}>
                  {busy ? "Granting…" : "Grant Membership"}
                </Button>
              </form>
            </CardContent>
          </Card>
          
          <Card className="shadow-sm border-slate-200 rounded-xl bg-slate-50">
            <CardContent className="pt-6">
               <h3 className="mb-4 text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-2">
                 <KeyRound className="h-4 w-4" /> Available Roles
               </h3>
               <ul className="space-y-3 text-sm">
                 {roles.map((r) => (
                   <li key={r.id} className="flex items-center justify-between p-3 bg-white rounded-lg border border-slate-200 shadow-sm">
                     <span className="font-mono text-xs font-bold text-slate-700">{r.code}</span>
                     <Badge variant="outline" className={r.is_system ? "text-indigo-600 bg-indigo-50 border-indigo-200" : ""}>
                        {r.is_system ? "system" : "custom"}
                     </Badge>
                   </li>
                 ))}
                 {roles.length === 0 && (
                    <li className="text-center text-sm text-slate-400 py-4">No roles found</li>
                 )}
               </ul>
            </CardContent>
          </Card>
        </div>
      </div>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="sm:max-w-md w-full overflow-y-auto border-l-0 shadow-2xl">
          <SheetHeader className="mb-6">
            <SheetTitle className="text-2xl font-bold text-slate-900">New User</SheetTitle>
            <SheetDescription>
              Create a new user account. They will need to be assigned a membership before they can access HOA resources.
            </SheetDescription>
          </SheetHeader>
          <form onSubmit={createUser} className="space-y-6">
            <div className="space-y-2">
              <Label className="text-sm font-semibold text-slate-700">Email Address</Label>
              <Input
                type="email"
                placeholder="name@example.com"
                value={userForm.email}
                onChange={(e) => setUserForm({ ...userForm, email: e.target.value })}
                className="bg-slate-50 border-slate-200 focus-visible:ring-indigo-500"
                required
              />
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-semibold text-slate-700">Full Name</Label>
              <Input
                placeholder="John Doe"
                value={userForm.full_name}
                onChange={(e) => setUserForm({ ...userForm, full_name: e.target.value })}
                className="bg-slate-50 border-slate-200 focus-visible:ring-indigo-500"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-semibold text-slate-700">Temporary Password</Label>
              <Input
                type="password"
                placeholder="Min 8 characters"
                value={userForm.password}
                onChange={(e) => setUserForm({ ...userForm, password: e.target.value })}
                minLength={8}
                className="bg-slate-50 border-slate-200 focus-visible:ring-indigo-500"
                required
              />
            </div>
            <SheetFooter className="mt-8 pt-6 border-t border-slate-100 flex-col sm:flex-row gap-3 sm:space-x-0">
              <Button type="button" variant="outline" onClick={() => setSheetOpen(false)} className="w-full sm:w-auto">
                Cancel
              </Button>
              <Button type="submit" disabled={busy} className="w-full sm:w-auto bg-indigo-600 hover:bg-indigo-700 text-white">
                {busy ? "Creating…" : "Create User"}
              </Button>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>
    </div>
  );
}
