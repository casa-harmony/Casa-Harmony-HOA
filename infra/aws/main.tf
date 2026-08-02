# Cheapest AWS deploy: one EC2 (Free Tier t3.micro) running the repo's
# docker compose (Postgres + backend + frontend) behind Caddy for free HTTPS.
# Uses the default VPC/subnet so there are no NAT/VPC charges.

terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.0" }
  }
}

provider "aws" {
  region = var.aws_region
}

# --- Networking: reuse the account's default VPC + a default (public) subnet ---
data "aws_vpc" "default" {
  default = true
}

data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
  filter {
    name   = "default-for-az"
    values = ["true"]
  }
}

# Latest Amazon Linux 2023 AMI (x86_64) via the public SSM parameter.
data "aws_ssm_parameter" "al2023" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64"
}

locals {
  public_host = var.domain != "" ? var.domain : "${aws_eip.this.public_ip}.sslip.io"
}

# --- Security group: web (80/443) open; SSH only if a key is supplied ---
resource "aws_security_group" "this" {
  name        = "casa-harmony-sg"
  description = "Casa Harmony test box"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description = "HTTP (Caddy / ACME challenge)"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  ingress {
    description = "HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  dynamic "ingress" {
    for_each = var.ssh_public_key != "" ? [1] : []
    content {
      description = "SSH"
      from_port   = 22
      to_port     = 22
      protocol    = "tcp"
      cidr_blocks = [var.allowed_ssh_cidr]
    }
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
  tags = { Project = "casa-harmony" }
}

# --- Optional SSH key pair (otherwise use AWS Session Manager) ---
resource "aws_key_pair" "this" {
  count      = var.ssh_public_key != "" ? 1 : 0
  key_name   = "casa-harmony-key"
  public_key = var.ssh_public_key
}

# --- IAM role so you can connect via SSM Session Manager (no SSH needed) ---
resource "aws_iam_role" "ec2" {
  name = "casa-harmony-ec2"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ssm" {
  role       = aws_iam_role.ec2.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "this" {
  name = "casa-harmony-ec2"
  role = aws_iam_role.ec2.name
}

# --- Elastic IP (allocated first so its address is known for sslip.io host) ---
resource "aws_eip" "this" {
  domain = "vpc"
  tags   = { Project = "casa-harmony" }
}

# --- The instance ---
resource "aws_instance" "this" {
  ami                    = data.aws_ssm_parameter.al2023.value
  instance_type          = var.instance_type
  subnet_id              = data.aws_subnets.default.ids[0]
  vpc_security_group_ids = [aws_security_group.this.id]
  iam_instance_profile   = aws_iam_instance_profile.this.name
  key_name               = var.ssh_public_key != "" ? aws_key_pair.this[0].key_name : null

  root_block_device {
    volume_type = "gp3"
    volume_size = var.root_volume_gb
  }

  user_data = templatefile("${path.module}/user_data.sh.tftpl", {
    github_repo         = var.github_repo
    github_token        = var.github_token
    git_branch          = var.git_branch
    public_host         = local.public_host
    superadmin_email    = var.superadmin_email
    superadmin_password = var.superadmin_password
    environment         = var.environment
  })
  # Re-run bootstrap if the rendered script changes.
  user_data_replace_on_change = true

  tags = { Project = "casa-harmony", Name = "casa-harmony" }
}

resource "aws_eip_association" "this" {
  instance_id   = aws_instance.this.id
  allocation_id = aws_eip.this.id
}
