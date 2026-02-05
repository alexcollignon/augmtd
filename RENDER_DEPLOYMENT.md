# Deploy n8n to Render - One-Click Blueprint

This guide will help you deploy n8n to Render using Infrastructure as Code (Blueprint).

---

## 📋 What Gets Deployed

- ✅ **PostgreSQL Database** ($7/month) - for n8n data
- ✅ **n8n Web Service** ($7/month) - the workflow automation tool
- ✅ **Persistent Disk** (10GB) - for n8n workflows and credentials
- ✅ **Automatic HTTPS** - secure by default
- ✅ **Auto-generated passwords** - for database and n8n admin

**Total Cost**: ~$14/month

---

## 🚀 Deployment Steps

### **Step 1: Push Code to GitHub**

First, initialize a git repo and push to GitHub:

```bash
cd /Users/alexandrecollignon/Desktop/augmtd-agents

# Initialize git (if not already done)
git init

# Add files
git add render.yaml Dockerfile.n8n
git commit -m "Add n8n Render blueprint"

# Create a new repo on GitHub: augmtd-agents
# Then push:
git remote add origin https://github.com/YOUR_USERNAME/augmtd-agents.git
git branch -M main
git push -u origin main
```

### **Step 2: Deploy on Render**

1. Go to **https://dashboard.render.com**
2. Click **"New +"** → **"Blueprint"**
3. Click **"Connect a repository"**
4. Select your `augmtd-agents` repository
5. Render will detect the `render.yaml` file
6. Click **"Apply"**

### **Step 3: Wait for Deployment** ⏱️ ~5 minutes

Render will:
- ✅ Create PostgreSQL database
- ✅ Build n8n Docker image
- ✅ Deploy n8n service
- ✅ Set up HTTPS

You'll see progress in the dashboard.

### **Step 4: Get Your n8n Credentials**

Once deployed:

1. Go to **Render Dashboard** → **augmtd-n8n** service
2. Click **"Environment"** tab
3. Find these credentials:
   - `N8N_BASIC_AUTH_USER`: **admin**
   - `N8N_BASIC_AUTH_PASSWORD`: (click to reveal)
4. **Save these!** You'll need them to log in.

### **Step 5: Access n8n**

1. Click on your service URL (e.g., `https://augmtd-n8n.onrender.com`)
2. You'll see a login prompt
3. Enter:
   - **Username**: admin
   - **Password**: (from Step 4)
4. 🎉 You're in!

---

## ⚙️ Update Environment Variables (Important!)

After deployment, update the `WEBHOOK_URL` to your actual Render URL:

1. Go to **Render Dashboard** → **augmtd-n8n**
2. Copy your service URL (e.g., `https://augmtd-n8n.onrender.com`)
3. Click **"Environment"** tab
4. Update `WEBHOOK_URL` to your actual URL
5. Click **"Save Changes"**
6. Service will redeploy automatically

---

## 🔍 Verify It's Working

### Test 1: Health Check
Visit: `https://your-n8n-url.onrender.com/healthz`

Should return: `{"status":"ok"}`

### Test 2: Login
Visit: `https://your-n8n-url.onrender.com`

Should show n8n login page.

### Test 3: Create a Workflow
1. Log in to n8n
2. Click **"Add workflow"**
3. Add a **"Schedule Trigger"** node
4. Add a **"HTTP Request"** node
5. Save the workflow
6. ✅ If it saves, everything is working!

---

## 📊 What You Have Now

```
┌─────────────────────────────────────┐
│  Render (Production)                │
│                                     │
│  ┌─────────────────────────────┐  │
│  │  n8n Web Service            │  │
│  │  https://augmtd-n8n         │  │
│  │  .onrender.com              │  │
│  │                              │  │
│  │  - Workflow automation       │  │
│  │  - OAuth credentials         │  │
│  │  - Email sync workflows      │  │
│  └──────────┬──────────────────┘  │
│             │                      │
│  ┌──────────▼──────────────────┐  │
│  │  PostgreSQL Database        │  │
│  │  - n8n workflows            │  │
│  │  - credentials              │  │
│  │  - execution logs           │  │
│  └─────────────────────────────┘  │
└─────────────────────────────────────┘
```

---

## 🎯 Next Steps

After n8n is running:

1. **Connect Gmail** - Set up Gmail OAuth credentials
2. **Create email sync workflow** - Fetch emails every 5 minutes
3. **Set up webhook** - Send emails to your Next.js app
4. **Test the flow** - End-to-end email syncing

---

## 🐛 Troubleshooting

### Issue: "Service build failed"
**Solution**: Check the logs in Render dashboard. Usually a missing dependency or incorrect Dockerfile.

### Issue: "Can't connect to database"
**Solution**: Wait a few minutes. Database takes longer to start than web service.

### Issue: "502 Bad Gateway"
**Solution**: Service is still starting. Wait 2-3 minutes and refresh.

### Issue: "Forgot my n8n password"
**Solution**:
1. Go to Render Dashboard → augmtd-n8n → Environment
2. Delete the `N8N_BASIC_AUTH_PASSWORD` variable
3. Add it again with "Generate value"
4. Service will redeploy with new password

---

## 💰 Cost Optimization

Current setup: ~$14/month

**To reduce costs:**
- PostgreSQL: Use free tier (500MB limit) - $0/month
- n8n: Use free tier (750 hours/month) - $0/month

**Total Free Tier**: $0/month (perfect for testing!)

**Note**: Free tier services spin down after 15 minutes of inactivity. First request takes ~30 seconds to wake up.

---

## 🔒 Security Notes

- ✅ HTTPS enabled by default
- ✅ Basic auth protects n8n UI
- ✅ Database password auto-generated
- ✅ Encryption key auto-generated
- ⚠️ Don't commit sensitive env vars to git
- ⚠️ Rotate credentials regularly

---

## 📚 Useful Links

- **Render Dashboard**: https://dashboard.render.com
- **n8n Documentation**: https://docs.n8n.io
- **Render Docs**: https://render.com/docs
- **n8n Community**: https://community.n8n.io

---

Ready to deploy? Follow Step 1! 🚀
