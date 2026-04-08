import React, { useState, useEffect, useMemo } from "react";
import { User } from "@/api/entities";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  MoreHorizontal,
  User as UserIcon,
  Shield,
  Briefcase,
  School as SchoolIcon,
  Store,
  BookOpen,
  Search,
  Loader2,
  Link2,
  XCircle,
} from "lucide-react";
import { format } from "date-fns";
import InviteUsersDialog from "@/components/invites/InviteUserDialog";

const roleIcons = {
  admin: <Shield className="w-4 h-4 text-red-500" />,
  agent: <Briefcase className="w-4 h-4 text-blue-500" />,
  school: <SchoolIcon className="w-4 h-4 text-purple-500" />,
  tutor: <BookOpen className="w-4 h-4 text-green-500" />,
  vendor: <Store className="w-4 h-4 text-orange-500" />,
  user: <UserIcon className="w-4 h-4 text-gray-500" />,
  student: <UserIcon className="w-4 h-4 text-gray-500" />,
};

const roleLabels = {
  admin: "Admin",
  agent: "Agent",
  school: "School",
  tutor: "Tutor",
  vendor: "Vendor",
  user: "User",
  student: "Student",
};

function flagUrlFromCode(code) {
  const cc = (code || "").toString().trim().toLowerCase();
  if (!/^[a-z]{2}$/.test(cc)) return "";
  return `https://flagcdn.com/w20/${cc}.png`;
}

function toDate(value) {
  if (!value) return null;

  if (typeof value?.toDate === "function") {
    const d = value.toDate();
    return Number.isNaN(d?.getTime?.()) ? null : d;
  }

  if (value?.seconds) {
    const d = new Date(value.seconds * 1000);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function safeFormat(value, fmt = "MMM dd, yyyy") {
  const d = toDate(value);
  return d ? format(d, fmt) : "—";
}

function getUserRole(user) {
  return (
    user?.user_type ||
    user?.userType ||
    user?.role ||
    user?.selected_role ||
    "user"
  )
    .toString()
    .toLowerCase();
}

function getVerificationStatus(user) {
  return (
    user?.verification_status ||
    user?.verification?.status ||
    "not_submitted"
  );
}

function getVerificationLabel(status) {
  switch (status) {
    case "approved":
    case "verified":
      return "Verified";
    case "pending":
      return "Pending";
    case "rejected":
      return "Rejected";
    case "not_submitted":
    default:
      return "Not Submitted";
  }
}

function getStatusClasses(status) {
  switch (status) {
    case "approved":
    case "verified":
      return "bg-green-100 text-green-700 border-green-200";
    case "pending":
      return "bg-yellow-100 text-yellow-700 border-yellow-200";
    case "rejected":
      return "bg-red-100 text-red-700 border-red-200";
    case "not_submitted":
    default:
      return "bg-gray-100 text-gray-700 border-gray-200";
  }
}

function getAssignedAgentId(user) {
  return (
    user?.assigned_agent_id ||
    user?.assignedAgentId ||
    user?.referred_by_agent_id ||
    user?.linked_agent_id ||
    user?.agent_id ||
    ""
  );
}

function canAssignAgent(user) {
  const role = getUserRole(user);
  return role === "user" || role === "student";
}

function CountryDisplay({ country, countryCode }) {
  const flagUrl = flagUrlFromCode(countryCode);

  return (
    <div className="flex items-center gap-2 min-w-0">
      {flagUrl ? (
        <img
          src={flagUrl}
          alt={`${country || countryCode || "Country"} flag`}
          width={20}
          height={15}
          className="rounded-[2px] border shrink-0"
          loading="lazy"
          onError={(e) => {
            e.currentTarget.style.display = "none";
          }}
        />
      ) : null}

      <div className="min-w-0">
        <div className="truncate">{country || "N/A"}</div>
        <div className="text-xs text-muted-foreground">
          {countryCode || "—"}
        </div>
      </div>
    </div>
  );
}

function AssignedAgentDisplay({ agent }) {
  if (!agent) {
    return <span className="text-muted-foreground">Unassigned</span>;
  }

  return (
    <div className="min-w-0">
      <div className="font-medium truncate">{agent.full_name || "Unnamed Agent"}</div>
      <div className="text-xs text-muted-foreground truncate">
        {agent.email || agent.uid || "—"}
      </div>
    </div>
  );
}

export default function UserManagement() {
  const [users, setUsers] = useState([]);
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [assigning, setAssigning] = useState(false);

  const [searchTerm, setSearchTerm] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [verificationFilter, setVerificationFilter] = useState("all");
  const [inviteOpen, setInviteOpen] = useState(false);

  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  const [selectedAgentId, setSelectedAgentId] = useState("");

  useEffect(() => {
    const loadUsers = async () => {
      setLoading(true);
      try {
        const userData = await User.list();

        const normalized = Array.isArray(userData)
          ? userData.map((user) => ({
              ...user,
              _resolvedRole: getUserRole(user),
              _verificationStatus: getVerificationStatus(user),
              _createdAt: toDate(user?.created_at),
              _assignedAgentId: getAssignedAgentId(user),
            }))
          : [];

        const sorted = [...normalized].sort(
          (a, b) =>
            (b?._createdAt?.getTime?.() || 0) -
            (a?._createdAt?.getTime?.() || 0)
        );

        setUsers(sorted);
        setAgents(
          sorted.filter((user) => getUserRole(user) === "agent")
        );
      } catch (error) {
        console.error("Error loading users:", error);
        setUsers([]);
        setAgents([]);
      } finally {
        setLoading(false);
      }
    };

    loadUsers();
  }, []);

  const agentMap = useMemo(() => {
    const map = new Map();

    agents.forEach((agent) => {
      const possibleKeys = [
        agent?.id,
        agent?.uid,
        agent?.user_id,
      ].filter(Boolean);

      possibleKeys.forEach((key) => {
        map.set(String(key), agent);
      });
    });

    return map;
  }, [agents]);

  const filteredUsers = useMemo(() => {
    let filtered = [...users];

    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase().trim();

      filtered = filtered.filter((user) => {
        const assignedAgent = agentMap.get(String(user._assignedAgentId || ""));

        const values = [
          user.full_name,
          user.email,
          user.phone,
          user.country,
          user.country_code,
          user.uid,
          user._resolvedRole,
          user._verificationStatus,
          assignedAgent?.full_name,
          assignedAgent?.email,
        ];

        return values.some((value) =>
          String(value || "").toLowerCase().includes(q)
        );
      });
    }

    if (roleFilter !== "all") {
      filtered = filtered.filter((user) => user._resolvedRole === roleFilter);
    }

    if (verificationFilter !== "all") {
      filtered = filtered.filter(
        (user) => user._verificationStatus === verificationFilter
      );
    }

    return filtered;
  }, [users, searchTerm, roleFilter, verificationFilter, agentMap]);

  const openAssignDialog = (user) => {
    if (!canAssignAgent(user)) return;
    setSelectedUser(user);
    setSelectedAgentId(user?._assignedAgentId || "");
    setAssignDialogOpen(true);
  };

  const handleAssignAgent = async () => {
    if (!selectedUser) return;

    setAssigning(true);
    try {
      const payload = {
        assigned_agent_id: selectedAgentId || null,
        assignedAgentId: selectedAgentId || null,
      };

      await User.update(selectedUser.id || selectedUser.uid, payload);

      const updatedUsers = users.map((user) => {
        const matches =
          (user.id && selectedUser.id && user.id === selectedUser.id) ||
          (user.uid && selectedUser.uid && user.uid === selectedUser.uid);

        if (!matches) return user;

        return {
          ...user,
          ...payload,
          _assignedAgentId: selectedAgentId || "",
        };
      });

      setUsers(updatedUsers);
      setSelectedUser(null);
      setSelectedAgentId("");
      setAssignDialogOpen(false);
    } catch (error) {
      console.error("Error assigning agent:", error);
      alert("Failed to assign agent. Please check permissions and try again.");
    } finally {
      setAssigning(false);
    }
  };

  const handleClearAgent = async (user) => {
    if (!user) return;

    setAssigning(true);
    try {
      const payload = {
        assigned_agent_id: null,
        assignedAgentId: null,
      };

      await User.update(user.id || user.uid, payload);

      const updatedUsers = users.map((item) => {
        const matches =
          (item.id && user.id && item.id === user.id) ||
          (item.uid && user.uid && item.uid === user.uid);

        if (!matches) return item;

        return {
          ...item,
          ...payload,
          _assignedAgentId: "",
        };
      });

      setUsers(updatedUsers);
    } catch (error) {
      console.error("Error clearing agent:", error);
      alert("Failed to clear agent. Please check permissions and try again.");
    } finally {
      setAssigning(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <Loader2 className="w-12 h-12 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold">User Management</h1>
          <p className="text-gray-600 mt-1">
            Invite users and manage platform access
          </p>
        </div>

        <Button
          onClick={() => setInviteOpen(true)}
          className="bg-green-600 hover:bg-green-700"
        >
          <UserIcon className="w-4 h-4 mr-2" />
          Invite New User
        </Button>
      </div>

      <InviteUsersDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        allowedRoles={["agent", "school", "tutor", "vendor"]}
        defaultRole="agent"
        title="Invite User"
      />

      <Dialog open={assignDialogOpen} onOpenChange={setAssignDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Assign Agent</DialogTitle>
            <DialogDescription>
              Assign an agent to this user/student account.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div className="rounded-lg border p-3 bg-muted/30">
              <div className="text-sm font-medium">
                {selectedUser?.full_name || "N/A"}
              </div>
              <div className="text-sm text-muted-foreground">
                {selectedUser?.email || "—"}
              </div>
            </div>

            <div>
              <label className="text-sm font-medium mb-2 block">Select Agent</label>
              <Select value={selectedAgentId || ""} onValueChange={setSelectedAgentId}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose an agent" />
                </SelectTrigger>
                <SelectContent>
                  {agents.length === 0 ? (
                    <SelectItem value="no-agents" disabled>
                      No agents available
                    </SelectItem>
                  ) : (
                    agents.map((agent) => (
                      <SelectItem
                        key={agent.id || agent.uid}
                        value={String(agent.id || agent.uid)}
                      >
                        {agent.full_name || "Unnamed Agent"}
                        {agent.email ? ` — ${agent.email}` : ""}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setAssignDialogOpen(false);
                setSelectedUser(null);
                setSelectedAgentId("");
              }}
              disabled={assigning}
            >
              Cancel
            </Button>

            <Button
              variant="outline"
              onClick={() => setSelectedAgentId("")}
              disabled={assigning}
            >
              Clear Selection
            </Button>

            <Button
              onClick={handleAssignAgent}
              disabled={assigning || !selectedAgentId}
            >
              {assigning ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                "Save Agent"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Card>
        <CardHeader>
          <CardTitle>All Users</CardTitle>

          <div className="mt-4 flex flex-col lg:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
              <Input
                placeholder="Search by name, email, phone, country, UID, or assigned agent..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>

            <Select value={roleFilter} onValueChange={setRoleFilter}>
              <SelectTrigger className="w-full lg:w-52">
                <SelectValue placeholder="Filter by role">
                  {roleFilter === "all"
                    ? "All Roles"
                    : roleLabels[roleFilter] || roleFilter}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Roles</SelectItem>
                {Object.keys(roleIcons).map((role) => (
                  <SelectItem key={role} value={role}>
                    {roleLabels[role] || role}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={verificationFilter}
              onValueChange={setVerificationFilter}
            >
              <SelectTrigger className="w-full lg:w-56">
                <SelectValue placeholder="Filter by verification" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Verification</SelectItem>
                <SelectItem value="approved">Verified</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
                <SelectItem value="not_submitted">Not Submitted</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>

        <CardContent>
          <div className="mb-4 text-sm text-muted-foreground">
            Showing {filteredUsers.length} of {users.length} users
          </div>

          <div className="hidden md:block overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Assigned Agent</TableHead>
                  <TableHead>Country</TableHead>
                  <TableHead>Joined</TableHead>
                  <TableHead>Verification</TableHead>
                  <TableHead>Subscription</TableHead>
                  <TableHead>
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {filteredUsers.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={8}
                      className="text-center py-10 text-muted-foreground"
                    >
                      No users found.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredUsers.map((user) => {
                    const role = user._resolvedRole;
                    const verificationStatus = user._verificationStatus;
                    const verificationLabel =
                      getVerificationLabel(verificationStatus);
                    const assignedAgent = agentMap.get(
                      String(user._assignedAgentId || "")
                    );

                    return (
                      <TableRow key={user.id || user.uid}>
                        <TableCell>
                          <div className="font-medium">
                            {user.full_name || "N/A"}
                          </div>
                          <div className="text-sm text-muted-foreground">
                            {user.email || "—"}
                          </div>
                          {user.phone ? (
                            <div className="text-xs text-muted-foreground mt-1">
                              {user.phone}
                            </div>
                          ) : null}
                        </TableCell>

                        <TableCell>
                          <div className="flex items-center gap-2">
                            {roleIcons[role] || <UserIcon className="w-4 h-4" />}
                            {roleLabels[role] || role}
                          </div>
                        </TableCell>

                        <TableCell>
                          {canAssignAgent(user) ? (
                            <AssignedAgentDisplay agent={assignedAgent} />
                          ) : (
                            <span className="text-muted-foreground">N/A</span>
                          )}
                        </TableCell>

                        <TableCell>
                          <CountryDisplay
                            country={user.country}
                            countryCode={user.country_code}
                          />
                        </TableCell>

                        <TableCell>{safeFormat(user.created_at)}</TableCell>

                        <TableCell>
                          <span
                            className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${getStatusClasses(
                              verificationStatus
                            )}`}
                          >
                            {verificationLabel}
                          </span>
                        </TableCell>

                        <TableCell>
                          <div className="capitalize">
                            {user.subscription_status || "—"}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {user.subscription_plan || "No plan"}
                          </div>
                        </TableCell>

                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" className="h-8 w-8 p-0">
                                <span className="sr-only">Open menu</span>
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem>View details</DropdownMenuItem>
                              <DropdownMenuItem>Edit user</DropdownMenuItem>

                              {canAssignAgent(user) ? (
                                <DropdownMenuItem onClick={() => openAssignDialog(user)}>
                                  <Link2 className="w-4 h-4 mr-2" />
                                  {user._assignedAgentId ? "Change Agent" : "Assign Agent"}
                                </DropdownMenuItem>
                              ) : null}

                              {canAssignAgent(user) && user._assignedAgentId ? (
                                <DropdownMenuItem onClick={() => handleClearAgent(user)}>
                                  <XCircle className="w-4 h-4 mr-2" />
                                  Clear Agent
                                </DropdownMenuItem>
                              ) : null}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>

          <div className="md:hidden grid grid-cols-1 gap-4">
            {filteredUsers.length === 0 ? (
              <Card className="p-6 text-center text-muted-foreground">
                No users found.
              </Card>
            ) : (
              filteredUsers.map((user) => {
                const role = user._resolvedRole;
                const verificationStatus = user._verificationStatus;
                const verificationLabel =
                  getVerificationLabel(verificationStatus);
                const assignedAgent = agentMap.get(
                  String(user._assignedAgentId || "")
                );

                return (
                  <Card key={user.id || user.uid} className="p-4">
                    <div className="flex justify-between items-start gap-3">
                      <div className="min-w-0">
                        <p className="font-bold truncate">
                          {user.full_name || "N/A"}
                        </p>
                        <p className="text-sm text-gray-500 truncate">
                          {user.email || "—"}
                        </p>
                        {user.phone ? (
                          <p className="text-xs text-gray-500 mt-1">
                            {user.phone}
                          </p>
                        ) : null}
                      </div>

                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            className="h-8 w-8 p-0 shrink-0"
                          >
                            <span className="sr-only">Open menu</span>
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem>View details</DropdownMenuItem>
                          <DropdownMenuItem>Edit user</DropdownMenuItem>

                          {canAssignAgent(user) ? (
                            <DropdownMenuItem onClick={() => openAssignDialog(user)}>
                              <Link2 className="w-4 h-4 mr-2" />
                              {user._assignedAgentId ? "Change Agent" : "Assign Agent"}
                            </DropdownMenuItem>
                          ) : null}

                          {canAssignAgent(user) && user._assignedAgentId ? (
                            <DropdownMenuItem onClick={() => handleClearAgent(user)}>
                              <XCircle className="w-4 h-4 mr-2" />
                              Clear Agent
                            </DropdownMenuItem>
                          ) : null}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>

                    <div className="mt-4 pt-4 border-t space-y-2 text-sm">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-gray-500">Role</span>
                        <div className="flex items-center gap-2">
                          {roleIcons[role] || <UserIcon className="w-4 h-4" />}
                          {roleLabels[role] || role}
                        </div>
                      </div>

                      <div className="flex items-start justify-between gap-3">
                        <span className="text-gray-500">Assigned Agent</span>
                        <div className="max-w-[65%] text-right">
                          {canAssignAgent(user) ? (
                            assignedAgent ? (
                              <div>
                                <div className="font-medium truncate">
                                  {assignedAgent.full_name || "Unnamed Agent"}
                                </div>
                                <div className="text-xs text-muted-foreground truncate">
                                  {assignedAgent.email || assignedAgent.uid || "—"}
                                </div>
                              </div>
                            ) : (
                              <span className="text-muted-foreground">Unassigned</span>
                            )
                          ) : (
                            <span className="text-muted-foreground">N/A</span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-start justify-between gap-3">
                        <span className="text-gray-500">Country</span>
                        <div className="max-w-[65%]">
                          <CountryDisplay
                            country={user.country}
                            countryCode={user.country_code}
                          />
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-3">
                        <span className="text-gray-500">Joined</span>
                        <span>{safeFormat(user.created_at, "MMM yyyy")}</span>
                      </div>

                      <div className="flex items-center justify-between gap-3">
                        <span className="text-gray-500">Verification</span>
                        <span
                          className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${getStatusClasses(
                            verificationStatus
                          )}`}
                        >
                          {verificationLabel}
                        </span>
                      </div>

                      <div className="flex items-center justify-between gap-3">
                        <span className="text-gray-500">Subscription</span>
                        <span className="capitalize">
                          {user.subscription_status || "—"}
                        </span>
                      </div>

                      {canAssignAgent(user) ? (
                        <div className="pt-2">
                          <Button
                            variant="outline"
                            className="w-full"
                            onClick={() => openAssignDialog(user)}
                          >
                            <Link2 className="w-4 h-4 mr-2" />
                            {user._assignedAgentId ? "Change Agent" : "Assign Agent"}
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  </Card>
                );
              })
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}