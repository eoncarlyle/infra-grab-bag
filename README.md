# README
Place to put various infrastructure automations that I don't want to forget about 

## New Server Setup
Steps taken from Wolfgang's excellent ['Ansible Home Server Pt. 1'](https://youtu.be/Z7p9-m4cimg?si=HP4haT-8MGJ2gzn7), basic server hardening but my infrastructure doesn't warrant Ansible and I don't want to keep having to go back to the video every time I provision a new host

- Key creation: `ssh-keygen -o -a 100 -t ed25519 -f ~/.ssh/myKey`
- Key copying: `ssh-copy-id -i ~/.ssh/myKey myHost`
- Disable SSH password authentication at `/etc/ssh/sshd_config`, `PasswordAuthentication no`
- Passwordless `sudo` with `visudo` at `/etc/sudoers`, pattern `{{ username }} ALL=(ALL) NOPASSWD: ALL`
