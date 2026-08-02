output "public_ip" {
  description = "Elastic IP of the server"
  value       = aws_eip.this.public_ip
}

output "app_url" {
  description = "Open this once bootstrap finishes (~3-5 min after apply)"
  value       = "https://${local.public_host}"
}

output "api_docs_url" {
  value = "https://${local.public_host}/docs"
}

output "ssh_command" {
  description = "SSH in (only if you supplied ssh_public_key)"
  value       = var.ssh_public_key != "" ? "ssh ec2-user@${aws_eip.this.public_ip}" : "set ssh_public_key to enable SSH, or use: aws ssm start-session --target ${aws_instance.this.id}"
}

output "ssm_command" {
  description = "Connect without SSH via Session Manager"
  value       = "aws ssm start-session --target ${aws_instance.this.id} --region ${var.aws_region}"
}
