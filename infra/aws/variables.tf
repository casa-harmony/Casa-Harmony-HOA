variable "aws_region" {
  description = "AWS region to deploy into"
  type        = string
  default     = "us-east-1"
}

variable "instance_type" {
  description = "EC2 instance type (t3.micro is Free Tier eligible)"
  type        = string
  default     = "t3.micro"
}

variable "root_volume_gb" {
  description = "Root EBS volume size (GB)"
  type        = number
  default     = 20
}

variable "ssh_public_key" {
  description = "Your SSH public key (e.g. contents of ~/.ssh/id_ed25519.pub). Leave empty to use SSM Session Manager instead of SSH."
  type        = string
  default     = ""
}

variable "allowed_ssh_cidr" {
  description = "CIDR allowed to SSH (only used if ssh_public_key is set). Restrict to your IP, e.g. 203.0.113.4/32."
  type        = string
  default     = "0.0.0.0/0"
}

variable "github_repo" {
  description = "owner/repo to deploy"
  type        = string
  default     = "cacheravi/casa-harmony"
}

variable "github_token" {
  description = "GitHub token with read access (required for a PRIVATE repo). Leave empty if the repo is public."
  type        = string
  default     = ""
  sensitive   = true
}

variable "git_branch" {
  description = "Branch to deploy"
  type        = string
  default     = "feat/mvp-multitenant-erp"
}

variable "domain" {
  description = "Custom domain pointing at the Elastic IP. Leave empty to use <eip>.sslip.io (free, HTTPS works)."
  type        = string
  default     = ""
}

variable "superadmin_email" {
  description = "Initial platform SUPERADMIN email"
  type        = string
  default     = "superadmin@casaharmony.ai"
}

variable "superadmin_password" {
  description = "Initial SUPERADMIN password (change after first login)"
  type        = string
  default     = "ChangeMe!Superadmin1"
  sensitive   = true
}

variable "environment" {
  description = "App ENVIRONMENT. 'development' exposes resident OTP codes for testers; use 'production' otherwise."
  type        = string
  default     = "development"
}
